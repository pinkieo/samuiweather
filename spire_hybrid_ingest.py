#!/usr/bin/env python3
"""
Spire hybrid ingest: OPF (optimized) + standard point (clouds + thunderstorm),
merge on valid_time, beach score 1–10, upsert into PostgreSQL `test_py`.

Env (.env or .env.local):
  SPIRE_API_TOKEN   — required
  DATABASE_URL      — PostgreSQL connection URI (required for DB write)

Optional:
  DRY_RUN=1         — fetch + merge + print, no database
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests
except ImportError:
    print("Install: pip install requests python-dotenv psycopg2-binary", file=sys.stderr)
    raise

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore

try:
    import psycopg2
except ImportError:
    psycopg2 = None  # type: ignore

SPIRE_BASE = "https://api.wx.spire.com"
SAMUI_LAT = 9.5120
SAMUI_LON = 100.0136
OPF_LOCATION = "custom:PR_W1XNKK0"
LOCATION_ID = "samui_hybrid_v1"

USER_AGENT = "SamuiSpireHybridIngest/1.0"


def load_env() -> None:
    if load_dotenv:
        for name in (".env.local", ".env"):
            p = os.path.join(os.path.dirname(__file__), name)
            if os.path.isfile(p):
                load_dotenv(p)
                break
        else:
            load_dotenv()


def k_to_c(k: Optional[float]) -> Optional[float]:
    if k is None:
        return None
    return round(k - 273.15, 2)


def pick_num(v: Dict[str, Any], keys: Tuple[str, ...]) -> Optional[float]:
    for k in keys:
        x = v.get(k)
        if isinstance(x, (int, float)) and not (isinstance(x, float) and x != x):
            return float(x)
    return None


def parse_rows(payload: Any) -> List[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    out: List[Dict[str, Any]] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        times = entry.get("times") or {}
        vt = times.get("valid_time") if isinstance(times, dict) else None
        if not vt:
            continue
        vals = entry.get("values")
        if not isinstance(vals, dict):
            vals = {}
        out.append({"valid_time": str(vt), "values": vals})
    return out


def normalize_time_key(iso: str) -> str:
    """Normalize to UTC ISO for matching."""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return iso


def fetch_opf_basic(token: str) -> Dict[str, Any]:
    params = {
        "location": OPF_LOCATION,
        "bundles": "basic",
        "time_bundle": "hourly",
        "forecast_hours": "72",
    }
    url = f"{SPIRE_BASE}/forecast/point/optimized"
    r = requests.get(
        url,
        params=params,
        headers={"spire-api-key": token, "User-Agent": USER_AGENT},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def fetch_standard_clouds_thunder(token: str) -> Dict[str, Any]:
    params = {
        "lat": str(SAMUI_LAT),
        "lon": str(SAMUI_LON),
        "bundles": "clouds,thunderstorm",
        "time_bundle": "hourly",
        "forecast_hours": "72",
    }
    url = f"{SPIRE_BASE}/forecast/point"
    r = requests.get(
        url,
        params=params,
        headers={"spire-api-key": token, "User-Agent": USER_AGENT},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def merge_forecasts(
    opf: Dict[str, Any], std: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Merge on valid_time: OPF wins for base fields; standard always supplies layers + CAPE + LI."""
    op_rows = {normalize_time_key(r["valid_time"]): r["values"] for r in parse_rows(opf)}
    st_rows = {normalize_time_key(r["valid_time"]): r["values"] for r in parse_rows(std)}
    all_keys = sorted(set(op_rows.keys()) | set(st_rows.keys()))

    opf_priority = (
        "air_temperature",
        "wind_speed",
        "wind_direction",
        "wind_gust",
        "relative_humidity",
        "total_cloud_cover",
        "cloud_cover",
        "precipitation_rate",
        "probability_of_precipitation",
        "apparent_temperature",
    )
    standard_extra = (
        "low_cloud_cover",
        "cloud_cover_low",
        "low_level_cloud_cover",
        "medium_cloud_cover",
        "mid_cloud_cover",
        "cloud_cover_mid",
        "mid_level_cloud_cover",
        "high_cloud_cover",
        "cloud_cover_high",
        "high_level_cloud_cover",
        "cape",
        "CAPE",
        "convective_available_potential_energy",
        "lifted_index",
        "lifted_index_500",
    )

    merged: List[Dict[str, Any]] = []
    for vk in all_keys:
        ov = dict(op_rows.get(vk) or {})
        sv = dict(st_rows.get(vk) or {})
        combined = {**sv, **ov}
        for key in opf_priority:
            if key in ov:
                combined[key] = ov[key]
        for key in standard_extra:
            if key in sv:
                combined[key] = sv[key]

        merged.append({"valid_time": vk, "values": combined})
    return merged


def cloud_pct(v: Dict[str, Any], *keys: str) -> float:
    x = pick_num(v, keys)
    if x is None:
        return 0.0
    if 0 <= x <= 1.0:
        return x * 100.0
    return max(0.0, min(100.0, x))


def calculate_beach_score(row_values: Dict[str, Any]) -> float:
    """
    Score 1.0–10.0 (display as 1–10).
    Clouds: low / mid / high weights 0.8 / 0.4 / 0.1 on 0–100% scale.
    CAPE: penalty above 1000 J/kg.
    Wind: small bonus 4–6 m/s; penalty above 12 m/s.
    """
    v = row_values
    low = cloud_pct(
        v,
        "low_cloud_cover",
        "cloud_cover_low",
        "low_level_cloud_cover",
    )
    mid = cloud_pct(
        v,
        "medium_cloud_cover",
        "mid_cloud_cover",
        "cloud_cover_mid",
        "mid_level_cloud_cover",
    )
    high = cloud_pct(
        v,
        "high_cloud_cover",
        "cloud_cover_high",
        "high_level_cloud_cover",
    )

    score = 10.0
    score -= (low / 100.0) * 0.8
    score -= (mid / 100.0) * 0.4
    score -= (high / 100.0) * 0.1

    cape = pick_num(
        v,
        ("cape", "CAPE", "convective_available_potential_energy"),
    )
    if cape is not None and cape > 1000:
        score -= min(3.0, (cape - 1000.0) / 800.0)

    wind = pick_num(v, ("wind_speed",))
    if wind is not None:
        if 4.0 <= wind <= 6.0:
            score += 0.35
        elif wind > 12.0:
            score -= min(2.5, (wind - 12.0) * 0.35)

    return max(1.0, min(10.0, round(score, 2)))


def row_to_record(
    valid_time: str, values: Dict[str, Any]
) -> Tuple[Any, ...]:
    """Flatten merged values + derived °C for storage."""
    air_k = pick_num(values, ("air_temperature",))
    air_c = k_to_c(air_k) if air_k is not None else None
    wind = pick_num(values, ("wind_speed",))
    total = pick_num(values, ("total_cloud_cover", "cloud_cover"))
    low = pick_num(
        values,
        (
            "low_cloud_cover",
            "cloud_cover_low",
            "low_level_cloud_cover",
        ),
    )
    mid = pick_num(
        values,
        (
            "medium_cloud_cover",
            "mid_cloud_cover",
            "cloud_cover_mid",
            "mid_level_cloud_cover",
        ),
    )
    high = pick_num(
        values,
        (
            "high_cloud_cover",
            "cloud_cover_high",
            "high_level_cloud_cover",
        ),
    )
    cape = pick_num(
        values,
        ("cape", "CAPE", "convective_available_potential_energy"),
    )
    li = pick_num(values, ("lifted_index", "lifted_index_500"))

    bs = calculate_beach_score(values)

    return (
        LOCATION_ID,
        valid_time,
        air_c,
        wind,
        total,
        low,
        mid,
        high,
        cape,
        li,
        bs,
        json.dumps(values),
    )


def ensure_table(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS test_py (
              location_id   TEXT NOT NULL,
              valid_time    TIMESTAMPTZ NOT NULL,
              air_temperature_c   DOUBLE PRECISION,
              wind_speed_ms       DOUBLE PRECISION,
              total_cloud_cover   DOUBLE PRECISION,
              low_cloud_cover     DOUBLE PRECISION,
              mid_cloud_cover     DOUBLE PRECISION,
              high_cloud_cover    DOUBLE PRECISION,
              cape                DOUBLE PRECISION,
              lifted_index        DOUBLE PRECISION,
              beach_score         DOUBLE PRECISION,
              values_json         JSONB,
              updated_at          TIMESTAMPTZ DEFAULT NOW(),
              PRIMARY KEY (location_id, valid_time)
            );
            """
        )
    conn.commit()


def upsert_rows(conn: Any, records: List[Tuple[Any, ...]]) -> None:
    """Fallback without execute_values batching."""
    sql = """
    INSERT INTO test_py (
      location_id, valid_time, air_temperature_c, wind_speed_ms, total_cloud_cover,
      low_cloud_cover, mid_cloud_cover, high_cloud_cover, cape, lifted_index,
      beach_score, values_json
    ) VALUES (
      %s, %s::timestamptz, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
    )
    ON CONFLICT (location_id, valid_time) DO UPDATE SET
      air_temperature_c = EXCLUDED.air_temperature_c,
      wind_speed_ms = EXCLUDED.wind_speed_ms,
      total_cloud_cover = EXCLUDED.total_cloud_cover,
      low_cloud_cover = EXCLUDED.low_cloud_cover,
      mid_cloud_cover = EXCLUDED.mid_cloud_cover,
      high_cloud_cover = EXCLUDED.high_cloud_cover,
      cape = EXCLUDED.cape,
      lifted_index = EXCLUDED.lifted_index,
      beach_score = EXCLUDED.beach_score,
      values_json = EXCLUDED.values_json,
      updated_at = NOW();
    """
    with conn.cursor() as cur:
        for r in records:
            cur.execute(sql, r)
    conn.commit()


def main() -> int:
    load_env()
    dry = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")
    token = (os.environ.get("SPIRE_API_TOKEN") or os.environ.get("SPIRE_API_KEY") or "").strip()
    if not token:
        print("Missing SPIRE_API_TOKEN (or SPIRE_API_KEY)", file=sys.stderr)
        return 1

    print("Fetching OPF (optimized, basic)…")
    opf = fetch_opf_basic(token)
    print("Fetching standard point (clouds + thunderstorm)…")
    std = fetch_standard_clouds_thunder(token)

    merged = merge_forecasts(opf, std)
    print(f"Merged rows: {len(merged)}")

    records: List[Tuple[Any, ...]] = []
    for m in merged:
        vt = m["valid_time"]
        vals = m["values"]
        records.append(row_to_record(vt, vals))

    # Preview
    for rec in records[:5]:
        print(
            f"  {rec[1]}  T={rec[2]}°C  wind={rec[3]}  score={rec[10]}  "
            f"low={rec[5]} mid={rec[6]} high={rec[7]} cape={rec[8]}"
        )

    if dry:
        print("DRY_RUN: skipping database.")
        return 0

    dsn = (os.environ.get("DATABASE_URL") or "").strip()
    if not dsn:
        print("Missing DATABASE_URL — set it or use DRY_RUN=1", file=sys.stderr)
        return 1
    if psycopg2 is None:
        print("Install psycopg2-binary", file=sys.stderr)
        return 1

    conn = psycopg2.connect(dsn)
    try:
        ensure_table(conn)
        upsert_rows(conn, records)
        print(f"Upserted {len(records)} rows into test_py.")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
