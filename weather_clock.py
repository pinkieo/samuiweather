#!/usr/bin/env python3
"""
Spire point forecast voor Koh Samui — tijdsopbouw volgens contract:
  0–48 uur: hourly
  48–120 uur: 3-hourly
  120–360 uur (15 dagen): 6-hourly

Eén call met time_bundle=hourly en forecast_hours=360 levert typisch maar ~48 uur;
we halen daarom drie responses op en mergen op valid_time (fijnere resolutie wint).

Spire-queryparam: time_bundle = hourly | 3_hourly | 6_hourly (underscore; niet "6hourly").
"""

from __future__ import annotations

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests
from dotenv import load_dotenv

load_dotenv(".env")
load_dotenv(".env.local", override=True)

SPIRE_POINT = "https://api.wx.spire.com/forecast/point"

# Koh Samui (gevraagd)
DEFAULT_LAT = 9.5127
DEFAULT_LON = 100.0137

# Bundles: uitbreidbaar via env (clouds/thunderstorm alleen als je token die toestaat)
DEFAULT_BUNDLES = "basic,maritime-atmos"

# Fijner interval = hoger prioriteitsgetal bij merge (zelfde valid_time)
TIER_PRIORITY = {"6_hourly": 1, "3_hourly": 2, "hourly": 3}


def normalize_time_key(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return iso


def parse_spire_data_entries(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    return [e for e in data if isinstance(e, dict)]


def row_from_entry(entry: Dict[str, Any], time_bundle: str) -> Optional[Dict[str, Any]]:
    times = entry.get("times")
    if not isinstance(times, dict):
        return None
    vt = times.get("valid_time")
    if not vt:
        return None
    vals = entry.get("values")
    if not isinstance(vals, dict):
        vals = {}
    return {
        "valid_time": normalize_time_key(str(vt)),
        "issuance_time": times.get("issuance_time"),
        "values": vals,
        "time_bundle": time_bundle,
        "_priority": TIER_PRIORITY.get(time_bundle, 0),
    }


def fetch_forecast(
    token: str,
    lat: float,
    lon: float,
    bundles: str,
    time_bundle: str,
    forecast_hours: int,
    timeout: int = 60,
) -> Tuple[str, Dict[str, Any]]:
    """
    Returns (time_bundle, json_body). On failure returns {"data": [], "error": "..."}.
    """
    params: Dict[str, Any] = {
        "lat": str(lat),
        "lon": str(lon),
        "bundles": bundles,
        "time_bundle": time_bundle,
        "forecast_hours": str(int(forecast_hours)),
    }
    try:
        r = requests.get(
            SPIRE_POINT,
            params=params,
            headers={"spire-api-key": token},
            timeout=timeout,
        )
        body = r.json() if r.text else {}
        if not isinstance(body, dict):
            body = {"data": [], "error": "non-object JSON"}
        if not r.ok:
            body = {
                **body,
                "error": body.get("message") or body.get("error") or f"HTTP {r.status_code}",
                "http_status": r.status_code,
            }
        return time_bundle, body
    except Exception as e:
        return time_bundle, {"data": [], "error": str(e)}


def merge_tiered_forecasts(
    responses: List[Tuple[str, Dict[str, Any]]],
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Merge rows from coarse → fine: bij dezelfde valid_time wint de hoogste _priority.
    Returns (merged_rows_sorted, warnings).
    """
    warnings: List[str] = []
    best: Dict[str, Dict[str, Any]] = {}

    # Verwerk van laag naar hoog priority zodat hourly als laatste wint
    ordered = sorted(
        responses,
        key=lambda x: min(TIER_PRIORITY.get(x[0], 0), 99),
    )
    for tb, payload in ordered:
        if payload.get("error") and not payload.get("data"):
            warnings.append(f"{tb}: {payload.get('error')}")
            continue
        entries = parse_spire_data_entries(payload)
        for entry in entries:
            row = row_from_entry(entry, tb)
            if not row:
                continue
            key = row["valid_time"]
            prev = best.get(key)
            if prev is None or row["_priority"] >= prev["_priority"]:
                best[key] = row

    merged = sorted(best.values(), key=lambda r: r["valid_time"])
    return merged, warnings


def hours_between_valid_times(a_iso: str, b_iso: str) -> float:
    try:
        ta = datetime.fromisoformat(a_iso.replace("Z", "+00:00")).timestamp()
        tb = datetime.fromisoformat(b_iso.replace("Z", "+00:00")).timestamp()
        return abs(tb - ta) / 3600.0
    except Exception:
        return float("nan")


def iter_rows_with_step_hours(
    merged: List[Dict[str, Any]],
) -> Iterable[Tuple[Dict[str, Any], float]]:
    """
    Voor verwerking: elke rij + uren tot de volgende (laatste rij: inf).
    Geen interpolatie — alleen de natuurlijke Spire-tijdstappen (1h / 3h / 6h).
    """
    for i, row in enumerate(merged):
        if i + 1 < len(merged):
            step_h = hours_between_valid_times(row["valid_time"], merged[i + 1]["valid_time"])
        else:
            step_h = float("inf")
        yield row, step_h


def run_clock(
    token: str,
    lat: float = DEFAULT_LAT,
    lon: float = DEFAULT_LON,
    bundles: str = DEFAULT_BUNDLES,
) -> Dict[str, Any]:
    """
    Contractmatige calls (parallel):
      - hourly, 48 uur
      - 3_hourly, 120 uur
      - 6_hourly, 360 uur  ← 15-daagse dekking grof raster
    """
    jobs = [
        ("hourly", 48),
        ("3_hourly", 120),
        ("6_hourly", 360),
    ]
    responses: List[Tuple[str, Dict[str, Any]]] = []
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = {
            ex.submit(fetch_forecast, token, lat, lon, bundles, tb, fh): (tb, fh)
            for tb, fh in jobs
        }
        for fut in as_completed(futs):
            tb, _ = futs[fut]
            try:
                name, body = fut.result()
                responses.append((name, body))
            except Exception as e:
                responses.append((tb, {"data": [], "error": str(e)}))

    merged, warnings = merge_tiered_forecasts(responses)

    span_h = 0.0
    if len(merged) >= 2:
        span_h = hours_between_valid_times(merged[0]["valid_time"], merged[-1]["valid_time"])

    step_samples: List[float] = []
    for _, step in iter_rows_with_step_hours(merged):
        if step != float("inf") and step == step:
            step_samples.append(round(step, 3))

    return {
        "lat": lat,
        "lon": lon,
        "bundles": bundles,
        "merged_row_count": len(merged),
        "span_hours_approx": round(span_h, 2),
        "step_hours_sample": step_samples[:24],
        "warnings": warnings,
        "merged": merged,
        "raw_responses_meta": [
            {
                "time_bundle": tb,
                "row_count": len(parse_spire_data_entries(p)),
                "error": p.get("error"),
                "http_status": p.get("http_status"),
            }
            for tb, p in responses
        ],
    }


def main() -> int:
    token = (os.getenv("SPIRE_API_TOKEN") or os.getenv("SPIRE_API_KEY") or "").strip()
    if not token:
        print("Zet SPIRE_API_TOKEN (of SPIRE_API_KEY) in .env", file=sys.stderr)
        return 1

    lat = float(os.getenv("WEATHER_CLOCK_LAT") or DEFAULT_LAT)
    lon = float(os.getenv("WEATHER_CLOCK_LON") or DEFAULT_LON)
    bundles = (os.getenv("WEATHER_CLOCK_BUNDLES") or DEFAULT_BUNDLES).strip()

    out = run_clock(token, lat=lat, lon=lon, bundles=bundles)

    # JSON naar stdout (inclusief merged data); voor groot bestand optioneel alleen stats
    if os.getenv("WEATHER_CLOCK_STATS_ONLY", "").lower() in ("1", "true", "yes"):
        slim = {k: v for k, v in out.items() if k != "merged"}
        slim["merged_row_count"] = out["merged_row_count"]
        print(json.dumps(slim, indent=2, default=str))
    else:
        print(json.dumps(out, indent=2, default=str))

    return 0 if out["merged_row_count"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
