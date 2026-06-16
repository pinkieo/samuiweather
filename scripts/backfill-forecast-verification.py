#!/usr/bin/env python3
"""
Join Ecowitt observations with archived Spire rows (weather_history) → forecast_verification.

Usage:
  python scripts/backfill-forecast-verification.py
  python scripts/backfill-forecast-verification.py --dry-run
  python scripts/backfill-forecast-verification.py --from 2026-05-19 --to 2026-06-17

Requires: pandas, supabase, python-dotenv
Run migration 20260617060000_forecast_verification.sql in Supabase first.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / ".env.local", override=True)

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

LOCATION_ID = "samui_opf_hybrid"
ECOWITT_LOCATION = "baan_ton_kluay"
BATCH_SIZE = 100
MAX_MATCH_HOURS = 2.0


def get_client():
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def fetch_all(sb, table: str, select: str, filters: dict[str, str]) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    page = 1000
    while True:
        q = sb.table(table).select(select)
        for k, v in filters.items():
            if k.endswith("_gte"):
                q = q.gte(k[:-4], v)
            elif k.endswith("_lte"):
                q = q.lte(k[:-4], v)
            elif k.endswith("_eq"):
                q = q.eq(k[:-3], v)
            elif k.endswith("_in"):
                q = q.in_(k[:-3], v)
        res = q.order("valid_time_utc" if "valid_time" in select else "observed_at").range(
            offset, offset + page - 1
        ).execute()
        chunk = res.data or []
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows


def to_json_safe(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: to_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [to_json_safe(v) for v in obj]
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat()
    if hasattr(obj, "item"):  # numpy scalar
        try:
            return obj.item()
        except Exception:
            pass
    if isinstance(obj, float) and pd.isna(obj):
        return None
    return obj


def spire_snapshot(row: dict) -> dict:
    return to_json_safe({
        "valid_time_utc": row.get("valid_time_utc"),
        "issuance_time_utc": row.get("issuance_time_utc"),
        "air_temperature_c": row.get("air_temperature_c"),
        "relative_humidity": row.get("relative_humidity"),
        "wind_speed_ms": row.get("wind_speed_ms"),
        "wind_direction_deg": row.get("wind_direction_deg"),
        "precipitation_rate": row.get("precipitation_rate"),
        "probability_of_precipitation_1hr": row.get("probability_of_precipitation_1hr"),
        "probability_of_thunderstorm": row.get("probability_of_thunderstorm"),
        "beach_score": row.get("beach_score"),
        "radar_status": row.get("radar_status"),
    })


def observation_snapshot(row: dict, source: str) -> dict:
    return to_json_safe({
        "source": source,
        "temperature_c": row.get("temperature_c"),
        "humidity_pct": row.get("humidity_pct"),
        "wind_speed_ms": row.get("wind_speed_ms"),
        "wind_direction_deg": row.get("wind_direction_deg"),
        "rain_rate_mmh": row.get("rain_rate_mmh"),
        "relative_pressure_hpa": row.get("relative_pressure_hpa"),
        "uv_index": row.get("uv_index"),
        "solar_wm2": row.get("solar_wm2"),
    })


def compute_errors(spire: dict, obs: dict) -> dict:
    out: dict[str, Any] = {}
    st = spire.get("air_temperature_c")
    ot = obs.get("temperature_c")
    if st is not None and ot is not None:
        out["temp_error_c"] = round(float(st) - float(ot), 3)
        out["temp_abs_error_c"] = round(abs(out["temp_error_c"]), 3)

    sh = spire.get("relative_humidity")
    oh = obs.get("humidity_pct")
    if sh is not None and oh is not None:
        out["humidity_error_pct"] = round(float(sh) - float(oh), 3)

    sw = spire.get("wind_speed_ms")
    ow = obs.get("wind_speed_ms")
    if sw is not None and ow is not None:
        out["wind_error_ms"] = round(float(sw) - float(ow), 3)

    sr = float(spire.get("precipitation_rate") or 0)
    orr = float(obs.get("rain_rate_mmh") or 0)
    spire_rain = sr > 0.05
    obs_rain = orr > 0.05
    out["spire_rain"] = spire_rain
    out["obs_rain"] = obs_rain
    out["rain_match"] = spire_rain == obs_rain

    pop = spire.get("probability_of_precipitation_1hr")
    if pop is not None:
        out["pop_pct"] = float(pop)

    return out


def lead_hours(issued: str | None, valid: str) -> float | None:
    if not issued:
        return None
    try:
        i = pd.Timestamp(issued)
        v = pd.Timestamp(valid)
        if i.tz is None:
            i = i.tz_localize("UTC")
        if v.tz is None:
            v = v.tz_localize("UTC")
        return round((v - i).total_seconds() / 3600, 2)
    except Exception:
        return None


def print_bias_report(df: pd.DataFrame) -> None:
    if df.empty:
        print("No pairs to report.")
        return
    print("\n=== Spire vs Ecowitt bias report ===")
    print(f"Pairs: {len(df)}")
    if "temp_error_c" in df.columns:
        print(f"  Temp MAE:  {df['temp_abs_error_c'].mean():.2f} C")
        print(f"  Temp bias: {df['temp_error_c'].mean():+.2f} C (Spire - station)")
    if "humidity_error_pct" in df.columns:
        print(f"  Humidity bias: {df['humidity_error_pct'].mean():+.1f} %")
    if "wind_error_ms" in df.columns:
        print(f"  Wind MAE:  {df['wind_error_ms'].abs().mean():.2f} m/s")
    if "rain_match" in df.columns:
        print(f"  Rain yes/no match: {df['rain_match'].mean() * 100:.0f}%")
    if "lead_hours" in df.columns and df["lead_hours"].notna().any():
        print(f"  Lead hours (mean): {df['lead_hours'].mean():.1f}h")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--from", dest="from_date", default="2026-05-19")
    parser.add_argument("--to", dest="to_date", default="2026-06-17")
    args = parser.parse_args()

    sb = get_client()
    t0 = f"{args.from_date}T00:00:00+00:00"
    t1 = f"{args.to_date}T23:59:59+00:00"

    print(f"Fetching Ecowitt {t0} .. {t1} …")
    eco = fetch_all(
        sb,
        "ecowitt_observations",
        "observed_at,station_type,temperature_c,humidity_pct,wind_speed_ms,wind_direction_deg,rain_rate_mmh,relative_pressure_hpa,uv_index,solar_wm2",
        {
            "location_id_eq": ECOWITT_LOCATION,
            "observed_at_gte": t0,
            "observed_at_lte": t1,
        },
    )
    print(f"  Ecowitt rows: {len(eco)}")

    print("Fetching Spire weather_history …")
    spire_rows = fetch_all(
        sb,
        "weather_history",
        "valid_time_utc,issuance_time_utc,air_temperature_c,relative_humidity,wind_speed_ms,wind_direction_deg,precipitation_rate,probability_of_precipitation_1hr,probability_of_thunderstorm,beach_score,radar_status",
        {
            "location_id_eq": LOCATION_ID,
            "valid_time_utc_gte": t0,
            "valid_time_utc_lte": t1,
        },
    )
    print(f"  Spire history rows (raw): {len(spire_rows)}")

    if not eco or not spire_rows:
        print("Not enough data to pair.", file=sys.stderr)
        return 1

    eco_df = pd.DataFrame(eco)
    eco_df["observed_at"] = pd.to_datetime(eco_df["observed_at"], utc=True)
    eco_df["hour_utc"] = eco_df["observed_at"].dt.floor("h")

    spire_df = pd.DataFrame(spire_rows)
    spire_df["valid_time_utc"] = pd.to_datetime(spire_df["valid_time_utc"], utc=True)
    spire_df = spire_df.dropna(subset=["air_temperature_c"])
    spire_df["issuance_time_utc"] = pd.to_datetime(spire_df["issuance_time_utc"], utc=True, errors="coerce")
    # Latest issuance per valid hour (forecast as archived before expiry)
    spire_df = spire_df.sort_values("issuance_time_utc").drop_duplicates("valid_time_utc", keep="last")
    print(f"  Spire unique hours: {len(spire_df)}")

    merged = eco_df.merge(
        spire_df,
        left_on="hour_utc",
        right_on="valid_time_utc",
        how="inner",
    )
    print(f"  Matched pairs: {len(merged)}")

    records: list[dict] = []
    error_rows: list[dict] = []

    for _, row in merged.iterrows():
        src = str(row.get("station_type") or "ecowitt")
        sp = spire_snapshot(row.to_dict())
        ob = observation_snapshot(row.to_dict(), src)
        errs = compute_errors(sp, ob)
        valid_iso = pd.Timestamp(row["valid_time_utc"]).isoformat()
        obs_iso = pd.Timestamp(row["observed_at"]).isoformat()
        issued = row.get("issuance_time_utc")
        issued_iso = pd.Timestamp(issued).isoformat() if pd.notna(issued) else None
        lh = lead_hours(issued_iso, valid_iso)

        records.append(
            to_json_safe({
                "location_id": LOCATION_ID,
                "forecast_valid_utc": valid_iso,
                "forecast_issued_utc": issued_iso,
                "lead_hours": lh,
                "spire_snapshot": sp,
                "observed_at_utc": obs_iso,
                "observation_source": "ecowitt",
                "observation": ob,
                "errors_json": errs,
            })
        )
        error_rows.append({**errs, "lead_hours": lh, "temp_error_c": errs.get("temp_error_c")})

    err_df = pd.DataFrame(error_rows)
    print_bias_report(err_df)

    if args.dry_run:
        if records:
            print("\nSample pair:")
            print(json.dumps(records[0], indent=2, default=str))
        return 0

    inserted = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        sb.table("forecast_verification").upsert(
            batch,
            on_conflict="location_id,forecast_valid_utc,observation_source,observed_at_utc",
        ).execute()
        inserted += len(batch)
        print(f"Upserted {inserted}/{len(records)} …")

    print(f"Done. {inserted} verification rows in forecast_verification.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
