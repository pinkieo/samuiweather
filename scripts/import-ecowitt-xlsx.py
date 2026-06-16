#!/usr/bin/env python3
"""
Import Ecowitt.net historical export (.xlsx) → Supabase ecowitt_observations.

Typical export name: all_KoSamuiThailand(202605010000-202605312359).xlsx

Usage:
  python scripts/import-ecowitt-xlsx.py data/ecowitt/all_KoSamuiThailand*.xlsx
  python scripts/import-ecowitt-xlsx.py path/to/file.xlsx --dry-run
  python scripts/import-ecowitt-xlsx.py path/to/file.xlsx --limit 100

Requires: pandas, openpyxl, supabase, python-dotenv
Loads .env then .env.local (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import timezone
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

DEFAULT_LOCATION_ID = "baan_ton_kluay"
DEFAULT_TZ = "Asia/Bangkok"
BATCH_SIZE = 200

# Normalized header token → db field / unit hint
COLUMN_ALIASES: dict[str, tuple[str, str | None]] = {
    "time": ("observed_at", None),
    "datetime": ("observed_at", None),
    "date": ("date_part", None),
    "outdoortemperature": ("temperature_c", "c"),
    "outdoor temperature": ("temperature_c", "c"),
    "outdoor temperature(c)": ("temperature_c", "c"),
    "outdoor temperature(celsius)": ("temperature_c", "c"),
    "outdoor temperature(f)": ("temperature_c", "f"),
    "outdoor temperature(fahrenheit)": ("temperature_c", "f"),
    "outdoor humidity": ("humidity_pct", None),
    "outdoor humidity(%)": ("humidity_pct", None),
    "indoor temperature": ("indoor_temperature_c", "c"),
    "indoor temperature(c)": ("indoor_temperature_c", "c"),
    "indoor temperature(f)": ("indoor_temperature_c", "f"),
    "indoor humidity": ("indoor_humidity_pct", None),
    "indoor humidity(%)": ("indoor_humidity_pct", None),
    "wind speed": ("wind_speed_ms", "ms"),
    "wind speed(m/s)": ("wind_speed_ms", "ms"),
    "wind speed(mph)": ("wind_speed_ms", "mph"),
    "wind speed(km/h)": ("wind_speed_ms", "kmh"),
    "gust speed": ("wind_gust_ms", "ms"),
    "gust speed(m/s)": ("wind_gust_ms", "ms"),
    "gust speed(mph)": ("wind_gust_ms", "mph"),
    "wind direction": ("wind_direction_deg", None),
    "wind direction(°)": ("wind_direction_deg", None),
    "rain rate": ("rain_rate_mmh", "mmh"),
    "rain rate(mm/h)": ("rain_rate_mmh", "mmh"),
    "rain rate(in/h)": ("rain_rate_mmh", "inh"),
    "hourly rain": ("rain_hour_mm", "mm"),
    "hourly rain(mm)": ("rain_hour_mm", "mm"),
    "daily rain": ("rain_day_mm", "mm"),
    "daily rain(mm)": ("rain_day_mm", "mm"),
    "relative pressure": ("relative_pressure_hpa", "hpa"),
    "relative pressure(hpa)": ("relative_pressure_hpa", "hpa"),
    "relative pressure(inhg)": ("relative_pressure_hpa", "inhg"),
    "absolute pressure": ("absolute_pressure_hpa", "hpa"),
    "absolute pressure(hpa)": ("absolute_pressure_hpa", "hpa"),
    "absolute pressure(inhg)": ("absolute_pressure_hpa", "inhg"),
    "solar radiation": ("solar_wm2", None),
    "solar radiation(w/m²)": ("solar_wm2", None),
    "solar radiation(w/m2)": ("solar_wm2", None),
    "uv index": ("uv_index", None),
    "uvi": ("uv_index", None),
    "outdoor temperature(c)": ("temperature_c", "c"),
    "outdoor humidity(%)": ("humidity_pct", None),
    "indoor temperature(c)": ("indoor_temperature_c", "c"),
    "indoor humidity(%)": ("indoor_humidity_pct", None),
    "rain rate(mm/hr)": ("rain_rate_mmh", "mmh"),
    "rainfall piezo rain rate(mm/hr)": ("rain_rate_mmh", "mmh"),
    "rainfall piezo hourly(mm)": ("rain_hour_mm", "mm"),
    "rainfall piezo daily(mm)": ("rain_day_mm", "mm"),
    "wind wind speed(km/h)": ("wind_speed_ms", "kmh"),
    "wind wind gust(km/h)": ("wind_gust_ms", "kmh"),
    "wind wind direction(o)": ("wind_direction_deg", None),
    "pressure relative(hpa)": ("relative_pressure_hpa", "hpa"),
    "pressure absolute(hpa)": ("absolute_pressure_hpa", "hpa"),
    "solar and uvi solar(w/m2)": ("solar_wm2", None),
    "solar and uvi uvi": ("uv_index", None),
}


def normalize_header(name: str) -> str:
    s = str(name).strip().lower()
    s = s.replace("℃", "c").replace("º", "o").replace("°f", "f").replace("°", "")
    s = s.replace("²", "2").replace("³", "3")
    s = re.sub(r"\s+", " ", s)
    return s


def f_to_c(f: float) -> float:
    return round((f - 32) * 5 / 9, 2)


def mph_to_ms(mph: float) -> float:
    return round(mph * 0.44704, 2)


def kmh_to_ms(kmh: float) -> float:
    return round(kmh / 3.6, 2)


def inhg_to_hpa(inhg: float) -> float:
    return round(inhg * 33.8638866667, 2)


def inh_to_mmh(inh: float) -> float:
    return round(inh * 25.4, 2)


def convert_value(field: str, unit: str | None, raw: Any) -> Any:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    if not pd.notna(v):
        return None

    if field in ("temperature_c", "indoor_temperature_c"):
        if unit == "f":
            return f_to_c(v)
        return round(v, 2)
    if field in ("wind_speed_ms", "wind_gust_ms"):
        if unit == "mph":
            return mph_to_ms(v)
        if unit == "kmh":
            return kmh_to_ms(v)
        return round(v, 2)
    if field in ("relative_pressure_hpa", "absolute_pressure_hpa"):
        if unit == "inhg":
            return inhg_to_hpa(v)
        return round(v, 2)
    if field == "rain_rate_mmh" and unit == "inh":
        return inh_to_mmh(v)
    if field in ("humidity_pct", "indoor_humidity_pct", "wind_direction_deg", "uv_index"):
        return round(v, 2) if field != "wind_direction_deg" else round(v)
    return round(v, 2) if isinstance(v, float) else v


def infer_column(key: str) -> tuple[str, str | None] | None:
    """Fallback heuristics for Ecowitt grouped export headers."""
    if key in ("time", "datetime") or key.endswith(" time"):
        return ("observed_at", None)
    if "outdoor" in key and "temperature" in key and "low" not in key and "high" not in key:
        return ("temperature_c", "f" if "(f)" in key else "c")
    if "outdoor" in key and "humidity" in key and "low" not in key and "high" not in key:
        return ("humidity_pct", None)
    if "indoor" in key and "temperature" in key and "low" not in key and "high" not in key:
        return ("indoor_temperature_c", "f" if "(f)" in key else "c")
    if "indoor" in key and "humidity" in key and "low" not in key and "high" not in key:
        return ("indoor_humidity_pct", None)
    if "rain rate" in key:
        return ("rain_rate_mmh", "mmh")
    if "hourly" in key and "rain" in key:
        return ("rain_hour_mm", "mm")
    if "daily" in key and "rain" in key:
        return ("rain_day_mm", "mm")
    if "wind speed" in key and "average" not in key:
        unit = "kmh" if "km/h" in key else "mph" if "mph" in key else "ms"
        return ("wind_speed_ms", unit)
    if "wind gust" in key:
        unit = "kmh" if "km/h" in key else "mph" if "mph" in key else "ms"
        return ("wind_gust_ms", unit)
    if "wind direction" in key and "average" not in key and "10-minute" not in key:
        return ("wind_direction_deg", None)
    if key.endswith("relative(hpa)") or ("relative" in key and "hpa" in key and "low" not in key and "high" not in key):
        return ("relative_pressure_hpa", "hpa")
    if key.endswith("absolute(hpa)") or ("absolute" in key and "hpa" in key):
        return ("absolute_pressure_hpa", "hpa")
    if "solar" in key and "w/m" in key:
        return ("solar_wm2", None)
    if key.endswith(" uvi") or key == "uvi":
        return ("uv_index", None)
    return None


def map_columns(df: pd.DataFrame) -> dict[str, tuple[str, str | None]]:
    mapped: dict[str, tuple[str, str | None]] = {}
    for col in df.columns:
        key = normalize_header(col)
        if key in COLUMN_ALIASES:
            mapped[col] = COLUMN_ALIASES[key]
            continue
        base = re.sub(r"\([^)]*\)", "", key).strip()
        if base in COLUMN_ALIASES:
            mapped[col] = COLUMN_ALIASES[base]
            continue
        inferred = infer_column(key)
        if inferred:
            mapped[col] = inferred
    return mapped


def parse_observed_series(df: pd.DataFrame, col_map: dict[str, tuple[str, str | None]]) -> pd.Series:
    time_cols = [c for c, (f, _) in col_map.items() if f == "observed_at"]
    date_cols = [c for c, (f, _) in col_map.items() if f == "date_part"]

    if time_cols:
        ts = pd.to_datetime(df[time_cols[0]], errors="coerce")
    elif date_cols:
        ts = pd.to_datetime(df[date_cols[0]], errors="coerce")
    else:
        # first column often time
        ts = pd.to_datetime(df.iloc[:, 0], errors="coerce")

    # Ecowitt exports are device-local (Asia/Bangkok) unless marked UTC
    if ts.dt.tz is None:
        ts = ts.dt.tz_localize(DEFAULT_TZ, ambiguous="infer", nonexistent="shift_forward")
    return ts.dt.tz_convert(timezone.utc)


def row_to_record(
    ts_utc: pd.Timestamp,
    row: pd.Series,
    col_map: dict[str, tuple[str, str | None]],
    source_file: str,
) -> dict[str, Any] | None:
    if pd.isna(ts_utc):
        return None

    record: dict[str, Any] = {
        "observed_at": ts_utc.isoformat(),
        "location_id": DEFAULT_LOCATION_ID,
        "station_type": "ecowitt-xlsx-import",
        "station_id": "Ko Samui Thailand",
        "raw_json": {"source": "ecowitt-xlsx", "file": source_file},
    }

    raw_json: dict[str, str] = {}
    for col, (field, unit) in col_map.items():
        if field in ("observed_at", "date_part"):
            continue
        val = convert_value(field, unit, row.get(col))
        if val is not None:
            record[field] = val
            raw_json[col] = str(row.get(col))

    if record.get("temperature_c") is None and record.get("humidity_pct") is None:
        return None

    record["raw_json"] = {**record["raw_json"], **raw_json}
    return record


def load_xlsx(path: Path) -> pd.DataFrame:
    """Ecowitt exports use row 0 = sensor group, row 1 = metric names."""
    raw = pd.read_excel(path, header=None)
    if raw.empty:
        return raw

    first = str(raw.iloc[0, 0]).strip().lower()
    if first != "time":
        df = pd.read_excel(path)
        df.columns = [str(c).strip() for c in df.columns]
        return df

    groups = raw.iloc[0].ffill()
    subs = raw.iloc[1]
    columns: list[str] = []
    for g, s in zip(groups, subs):
        g_str = "" if pd.isna(g) else str(g).strip()
        s_str = "" if pd.isna(s) else str(s).strip()
        if g_str.lower() == "time":
            columns.append("Time")
        elif g_str and s_str:
            columns.append(f"{g_str} {s_str}")
        elif s_str:
            columns.append(s_str)
        elif g_str:
            columns.append(g_str)
        else:
            columns.append("unnamed")

    df = raw.iloc[2:].copy()
    df.columns = columns
    df = df.reset_index(drop=True)
    return df


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Ecowitt xlsx export to Supabase")
    parser.add_argument("xlsx", type=Path, help="Path to .xlsx export from ecowitt.net")
    parser.add_argument("--dry-run", action="store_true", help="Parse only, no Supabase writes")
    parser.add_argument("--limit", type=int, default=0, help="Max rows to import (0 = all)")
    args = parser.parse_args()

    path = args.xlsx.resolve()
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        print(f"Drop exports in: {ROOT / 'data' / 'ecowitt'}/", file=sys.stderr)
        return 1

    print(f"Reading {path.name} …")
    df = load_xlsx(path)
    print(f"Rows: {len(df)}, columns: {list(df.columns)}")

    col_map = map_columns(df)
    if not any(f == "observed_at" or f == "date_part" for f, _ in col_map.values()):
        # assume first column is time
        first = df.columns[0]
        col_map[first] = ("observed_at", None)

    print("Mapped columns:")
    for col, (field, unit) in col_map.items():
        print(f"  {col!r} -> {field} ({unit or 'native'})")

    if not any(f == "temperature_c" for f, _ in col_map.values()):
        print("Warning: no outdoor temperature column detected — check headers", file=sys.stderr)

    ts = parse_observed_series(df, col_map)
    records: list[dict[str, Any]] = []
    limit = args.limit if args.limit > 0 else len(df)

    for i in range(min(len(df), limit)):
        rec = row_to_record(ts.iloc[i], df.iloc[i], col_map, path.name)
        if rec:
            records.append(rec)

    print(f"Parsed {len(records)} valid rows ({ts.min()} → {ts.max()} UTC)")

    if args.dry_run:
        print("Dry run — sample row:")
        print(json.dumps(records[0] if records else {}, indent=2, default=str))
        return 0

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local", file=sys.stderr)
        return 1

    from supabase import create_client

    sb = create_client(url, key)
    inserted = 0
    errors = 0

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        try:
            sb.table("ecowitt_observations").upsert(
                batch,
                on_conflict="location_id,observed_at",
            ).execute()
            inserted += len(batch)
            print(f"Upserted {inserted}/{len(records)} …")
        except Exception as e:
            errors += 1
            print(f"Batch {i // BATCH_SIZE} failed: {e}", file=sys.stderr)
            if errors > 3:
                return 1

    print(f"Done. Upserted {inserted} observations from {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
