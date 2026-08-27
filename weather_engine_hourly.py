#!/usr/bin/env python3
"""
Koh Samui Spire ingest (hourly cron) — aligned with Next.js `lib/spire.ts` getForecastMergedAt.

  Contract / 15-day spine (Spire ProSea Point): the long horizon uses time_bundle `6_hourly_15day`
  with forecast_hours=360. Plain `6_hourly` or `medium_range_std_freq` alone typically caps ~7 days —
  see `.cursor/skills/samui-concierge/SKILL.md` ("Spire forecast — 15-day Point API").

Pipeline:
  1. RPC archive_expired_forecasts(p_location_id) — keep weather_forecast clean
  2. Spire /forecast/point: prefer combined `hourly,3_hourly,6_hourly_15day` @ 360h; else tier-merge (6_hourly_15day + 3h + 1h).
     Parallel: /forecast/point/optimized (OPF) hourly ~72h — POP/thunder/fog overlay on the same valid_time (see `lib/spire.ts`)
  3. RainViewer tile sample at pin (same z7/512 scheme as the app)
  4. beach_score (clouds/thunder/ceiling + temp bonus; −3 when radar shows rain)
  5. append/dedupe weather_forecast_snapshot provenance rows
  6. upsert weather_forecast (incl. radar_status)

Env (.env / .env.local):
  SPIRE_API_TOKEN or SPIRE_API_KEY
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY

Optional:
  WEATHER_LOCATION_ID   (default: samui_opf_hybrid)
  SPIRE_FORECAST_BUNDLES (overrides first bundle try; matches app env)
  SPIRE_FORECAST_PRODUCT (e.g. sof-d), SPIRE_FORECAST_UNIT_SYSTEM (e.g. si) — Point query params if required
  SAMUI_LAT / SAMUI_LON
  DRY_RUN=1              (no Supabase writes)
  TEST_15DAY_SEA=1       (only Spire tier test: Singapore sea 1.25°N 103.80°E; no DB writes)
  SPIRE_OPF_ENABLED=0    (skip /forecast/point/optimized probability overlay)
  SPIRE_OPF_LOCATION     (default: custom:PR_W1XNKK0; else SPIRE_OPTIMIZED_POINT_LOCATION)
  SPIRE_OPF_FORECAST_HOURS (default 72) · SPIRE_OPF_BUNDLES (else basic,thunderstorm → basic)

`probability_of_fog` is written as a top-level column when present (OPF) — requires
`supabase/014_weather_forecast_probability_of_fog_if_missing.sql` in Supabase; it also
remains in `values_json` for backward compatibility and view COALESCE.
`pwat`, `dcape`, `cin` are written as top-level columns when the thunderstorm bundle
fills `values` — requires `supabase/020_weather_forecast_pwat_dcape_cin.sql`.

Note: FORECAST_HOURS is ignored — horizons are fixed by the tier list above.
Forecast issuance snapshots require `supabase/021_weather_forecast_snapshots.sql`.
"""

from __future__ import annotations

import os
import sys


def _maybe_reexec_windows_venv() -> None:
    """If .venv exists, re-run this script with that interpreter so `py` matches deps."""
    if os.name != "nt" or __name__ != "__main__":
        return
    root = os.path.dirname(os.path.abspath(__file__))
    venv_py = os.path.join(root, ".venv", "Scripts", "python.exe")
    if not os.path.isfile(venv_py):
        return
    cur = os.path.normcase(os.path.abspath(sys.executable))
    venv_abs = os.path.normcase(os.path.abspath(venv_py))
    if cur == venv_abs:
        return
    os.execv(venv_py, [venv_py] + sys.argv)


_maybe_reexec_windows_venv()

import hashlib
import json
import math
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, Literal, Optional, Tuple, cast
from zoneinfo import ZoneInfo

try:
    import requests
except ImportError:
    print(
        "Missing deps. From repo root:\n"
        "  Windows: run  weather-hourly.cmd   once (creates .venv + installs packages).\n"
        "  Then  py weather_engine_hourly.py  will auto-use .venv if present.\n"
        "  Or:  py -m pip install -r requirements-weather-engine.txt\n"
        "       (must be the same Python as  py -c \"import sys; print(sys.executable)\" )\n",
        file=sys.stderr,
    )
    raise

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore

try:
    from supabase import create_client, Client
except ImportError:
    create_client = None  # type: ignore
    Client = Any  # type: ignore

try:
    from PIL import Image
except ImportError:
    Image = None  # type: ignore

# Windows consoles often use cp1252; avoid UnicodeEncodeError on Spire log lines (≈, …, ✓, etc.).
if os.name == "nt":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

ICT = ZoneInfo("Asia/Bangkok")
SPIRE_BASE = "https://api.wx.spire.com"
# Match `lib/spire.ts` SAMUI_CENTER / weather_clock.py
SAMUI_LAT = 9.5127
SAMUI_LON = 100.0137
USER_AGENT = "SamuiWeatherEngine/1.0"
DEFAULT_OPF_LOCATION = "custom:PR_W1XNKK0"

FORECAST_BUNDLES_VACATION = "basic,maritime-atmos"
SPIRE_CONTRACT_TIER_PRIORITY: Dict[str, int] = {
    "medium_range": 0,
    "extended_15d": 0,
    "6_hourly_15day": 1,
    "6_hourly": 1,
    "3_hourly": 2,
    "hourly": 3,
}

# Same grid as lib/rainviewer-tile-sample.ts (native overlay)
RADAR_TILE_Z = 7
RADAR_TILE_PX = 512
RainEchoSample = Literal["precip", "none", "unknown"]
RadarStatus = Literal["clear", "rain", "unknown"]


def load_env() -> None:
    if load_dotenv:
        root = os.path.dirname(os.path.abspath(__file__))
        for name in (".env.local", ".env"):
            p = os.path.join(root, name)
            if os.path.isfile(p):
                load_dotenv(p)
                break
        else:
            load_dotenv()


def k_to_c(k: Optional[float]) -> Optional[float]:
    if k is None:
        return None
    return round(float(k) - 273.15, 3)


def pick_num(v: Dict[str, Any], keys: Tuple[str, ...]) -> Optional[float]:
    for k in keys:
        x = v.get(k)
        if isinstance(x, (int, float)) and not (isinstance(x, float) and x != x):
            return float(x)
    return None


def to_ict_label(iso_utc: str) -> str:
    """Human-readable ICT wall clock for storage / analytics."""
    try:
        dt = datetime.fromisoformat(iso_utc.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(ICT).strftime("%Y-%m-%d %H:%M ICT")
    except Exception:
        return iso_utc


def normalize_time_key(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return iso


def spire_bundle_chain() -> List[str]:
    """Same order as `bundleChain()` in lib/spire.ts."""
    env_b = (os.environ.get("SPIRE_FORECAST_BUNDLES") or "").strip()
    chain = [
        env_b,
        "basic,maritime-atmos,clouds,thunderstorm",
        FORECAST_BUNDLES_VACATION,
        "basic",
    ]
    seen: set[str] = set()
    out: List[str] = []
    for b in chain:
        if b and b not in seen:
            seen.add(b)
            out.append(b)
    return out


def valid_time_key_from_entry(entry: Dict[str, Any]) -> str:
    times = entry.get("times") or {}
    if not isinstance(times, dict):
        return ""
    vt = times.get("valid_time")
    if not vt:
        return ""
    return normalize_time_key(str(vt))


def compute_spire_point_data_stats(
    entries: List[Dict[str, Any]],
) -> Tuple[int, float, Optional[str], Optional[str]]:
    """Row count + span (hours) + first/last valid_time — mirrors lib/spire computeSpirePointDataStats."""
    if not entries:
        return 0, 0.0, None, None
    stamps: List[Tuple[str, float]] = []
    for e in entries:
        k = valid_time_key_from_entry(e)
        if not k:
            continue
        try:
            dt = datetime.fromisoformat(k.replace("Z", "+00:00"))
            stamps.append((k, dt.timestamp()))
        except Exception:
            continue
    if not stamps:
        return len(entries), 0.0, None, None
    stamps.sort(key=lambda x: x[1])
    span_h = (stamps[-1][1] - stamps[0][1]) / 3600.0
    return len(entries), span_h, stamps[0][0], stamps[-1][0]


def fetch_point_contract(
    token: str,
    lat: float,
    lon: float,
    bundles: str,
    time_bundle: str,
    forecast_hours: int,
    timeout: int = 90,
) -> List[Dict[str, Any]]:
    """GET /forecast/point — returns Spire `data` rows or []."""
    params: Dict[str, str] = {
        "lat": str(lat),
        "lon": str(lon),
        "bundles": bundles,
        "time_bundle": time_bundle,
        "forecast_hours": str(int(forecast_hours)),
    }
    prod = (os.environ.get("SPIRE_FORECAST_PRODUCT") or "").strip()
    if prod:
        params["product"] = prod
    units = (os.environ.get("SPIRE_FORECAST_UNIT_SYSTEM") or "").strip()
    if units:
        params["unit_system"] = units
    try:
        r = requests.get(
            f"{SPIRE_BASE}/forecast/point",
            params=params,
            headers={"spire-api-key": token, "User-Agent": USER_AGENT},
            timeout=timeout,
        )
        if not r.ok:
            return []
        j = r.json()
        if not isinstance(j, dict):
            return []
        data = j.get("data")
        if not isinstance(data, list):
            return []
        return [cast(Dict[str, Any], x) for x in data if isinstance(x, dict)]
    except Exception:
        return []


def try_fetch_first_bundle(
    token: str,
    lat: float,
    lon: float,
    time_bundle: str,
    forecast_hours: int,
) -> List[Dict[str, Any]]:
    for bundles in spire_bundle_chain():
        data = fetch_point_contract(token, lat, lon, bundles, time_bundle, forecast_hours)
        if data:
            return data
    return []


def normalize_prob_percent(x: float) -> float:
    """Spire may return 0–1 or 0–100; store/display as 0–100."""
    xf = float(x)
    if 0 <= xf <= 1.0:
        return round(xf * 100.0, 2)
    return round(max(0.0, min(100.0, xf)), 2)


def as_probability_percent(x: Optional[float]) -> float:
    if x is None:
        return 0.0
    return normalize_prob_percent(x)


def opf_location_from_env() -> str:
    for key in (
        "SPIRE_OPF_LOCATION",
        "SPIRE_OPTIMIZED_POINT_LOCATION",
        "SPIRE_OPTIMIZED_LOCATION",
    ):
        v = (os.environ.get(key) or "").strip()
        if v:
            return v
    return DEFAULT_OPF_LOCATION


def fetch_opf_optimized_hourly(
    token: str,
    location: str,
    forecast_hours: int = 72,
) -> List[Dict[str, Any]]:
    """GET /forecast/point/optimized — hourly rows; try basic,thunderstorm then basic."""
    env_b = (os.environ.get("SPIRE_OPF_BUNDLES") or "").strip()
    bundle_chain = [b for b in (env_b, "basic,thunderstorm", "basic") if b]
    seen: set[str] = set()
    prod = (os.environ.get("SPIRE_FORECAST_PRODUCT") or "").strip()
    units = (os.environ.get("SPIRE_FORECAST_UNIT_SYSTEM") or "").strip()
    for bundles in bundle_chain:
        if bundles in seen:
            continue
        seen.add(bundles)
        params: Dict[str, str] = {
            "location": location.strip(),
            "bundles": bundles,
            "time_bundle": "hourly",
            "forecast_hours": str(int(forecast_hours)),
        }
        if prod:
            params["product"] = prod
        if units:
            params["unit_system"] = units
        try:
            r = requests.get(
                f"{SPIRE_BASE}/forecast/point/optimized",
                params=params,
                headers={"spire-api-key": token, "User-Agent": USER_AGENT},
                timeout=90,
            )
            if not r.ok:
                continue
            j = r.json()
            if not isinstance(j, dict):
                continue
            data = j.get("data")
            if not isinstance(data, list) or not data:
                continue
            return [cast(Dict[str, Any], x) for x in data if isinstance(x, dict)]
        except Exception:
            continue
    return []


def extract_opf_probabilities_from_values(vals: Dict[str, Any]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    pop = pick_num(
        vals,
        (
            "probability_of_precipitation_1hr",
            "probability_of_precipitation",
            "pop",
        ),
    )
    if pop is not None:
        out["probability_of_precipitation_1hr_raw"] = float(pop)
        out["probability_of_precipitation_1hr"] = normalize_prob_percent(pop)
    p24 = pick_num(vals, ("probability_of_precipitation_24hr",))
    if p24 is not None:
        out["probability_of_precipitation_24hr_raw"] = float(p24)
        out["probability_of_precipitation_24hr"] = normalize_prob_percent(p24)
    th = pick_num(vals, ("probability_of_thunderstorm",))
    if th is not None:
        stored = normalize_prob_percent(th)
        out["probability_of_thunderstorm_raw"] = float(th)
        out["probability_of_thunderstorm"] = stored
        if float(th) == 1.0:
            print(
                f"[OPF] thunder raw={th} stored={stored} (1.0 treated as 100% fraction)",
                file=sys.stderr,
            )
    fg = pick_num(vals, ("probability_of_fog", "fog_probability"))
    if fg is not None:
        stored = normalize_prob_percent(fg)
        out["probability_of_fog_raw"] = float(fg)
        out["probability_of_fog"] = stored
        if float(fg) == 1.0:
            print(
                f"[OPF] fog raw={fg} stored={stored} (1.0 treated as 100% fraction)",
                file=sys.stderr,
            )
    return out


def build_opf_overlay_map(entries: List[Dict[str, Any]]) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {}
    for e in entries:
        k = valid_time_key_from_entry(e)
        if not k:
            continue
        vals = e.get("values")
        if not isinstance(vals, dict):
            continue
        probs = extract_opf_probabilities_from_values(vals)
        if probs:
            out[normalize_time_key(k)] = probs
    return out


def overlay_opf_probabilities(
    parsed_rows: List[Dict[str, Any]],
    opf_map: Dict[str, Dict[str, float]],
) -> None:
    if not opf_map:
        return
    n = 0
    for m in parsed_rows:
        k = normalize_time_key(str(m["valid_time"]))
        op = opf_map.get(k)
        if not op:
            continue
        vals = m.get("values")
        if not isinstance(vals, dict):
            vals = {}
            m["values"] = vals
        for pk, pv in op.items():
            vals[pk] = pv
        n += 1
    print(f"[OPF] Probability overlay op {n} timesteps", file=sys.stderr)


def merge_spire_contract_tiers(
    layers: List[Tuple[str, List[Dict[str, Any]]]],
) -> List[Dict[str, Any]]:
    """Coarse tiers first; same valid_time → higher SPIRE_CONTRACT_TIER_PRIORITY wins."""
    sorted_layers = sorted(
        layers,
        key=lambda x: SPIRE_CONTRACT_TIER_PRIORITY.get(x[0], 0),
    )
    best: Dict[str, Tuple[Dict[str, Any], int]] = {}
    for tier, entries in sorted_layers:
        p = SPIRE_CONTRACT_TIER_PRIORITY.get(tier, 0)
        for e in entries:
            k = valid_time_key_from_entry(e)
            if not k:
                continue
            cur = best.get(k)
            if cur is None or p >= cur[1]:
                best[k] = (e, p)
    return [best[k][0] for k in sorted(best.keys())]


def fetch_long_spine_layer(
    token: str,
    lat: float,
    lon: float,
    forecast_hours: int = 360,
) -> Tuple[str, List[Dict[str, Any]]]:
    """6_hourly_15day eerst (Spire ProSea); fallback 6_hourly → medium_range_std_freq."""
    for label, tb in (
        ("6_hourly_15day", "6_hourly_15day"),
        ("6_hourly", "6_hourly"),
        ("medium_range", "medium_range_std_freq"),
    ):
        data = try_fetch_first_bundle(token, lat, lon, tb, forecast_hours)
        if data:
            return label, data
    return "6_hourly_15day", []


def fetch_samui_15day_standard(
    token: str,
    lat: float,
    lon: float,
) -> List[Dict[str, Any]]:
    """
    Tier-merge /forecast/point: 6_hourly_15day (fallbacks) + 3_hourly + hourly.
    Prefer `fetch_samui_point_forecast` for the combined time_bundle first.
    """
    print(
        "=== Fetching Point (tier merge: 6_hourly_15day spine + 3h/1h) ===",
        file=sys.stderr,
    )
    layers: List[Tuple[str, List[Dict[str, Any]]]] = []
    long_fh = 360
    label, long_data = fetch_long_spine_layer(token, lat, lon, long_fh)
    print(f"Fetching {label} → {long_fh}h (long spine)", file=sys.stderr)
    if long_data:
        _n, span_h, vmin, vmax = compute_spire_point_data_stats(long_data)
        print(
            f"  ✓ {len(long_data)} rows | span≈{span_h / 24.0:.1f}d | {vmin} … {vmax}",
            file=sys.stderr,
        )
    else:
        print("  ✗ long spine: empty", file=sys.stderr)
    layers.append((label, long_data))

    for label2, time_bundle, fh in (
        ("3_hourly", "3_hourly", 120),
        ("hourly", "hourly", 48),
    ):
        print(f"Fetching {label2} → {fh}h ({time_bundle})", file=sys.stderr)
        try:
            data = try_fetch_first_bundle(token, lat, lon, time_bundle, fh)
        except Exception as e:
            print(f"  ✗ {label2} error: {e}", file=sys.stderr)
            data = []
        if data:
            vts = [valid_time_key_from_entry(r) for r in data]
            vts = [v for v in vts if v]
            vmax = max(vts) if vts else None
            print(f"  ✓ {len(data)} rows | max valid_time: {vmax}", file=sys.stderr)
        else:
            print(f"  ✗ {label2}: empty", file=sys.stderr)
        layers.append((label2, data))

    merged = merge_spire_contract_tiers(layers)
    if merged:
        stats = compute_spire_point_data_stats(merged)
        print(
            f"✅ Merged: {len(merged)} rows | span≈{stats[1]:.1f}h "
            f"({stats[2]} … {stats[3]})",
            file=sys.stderr,
        )
    else:
        print("❌ No data after merge", file=sys.stderr)
    return merged


def fetch_samui_point_forecast(
    token: str,
    lat: float,
    lon: float,
) -> List[Dict[str, Any]]:
    """
    Try one Gerald-style time_bundle call; otherwise tier-merge.
    OPF probabilities come separately (overlay), not in this call.
    """
    print(
        "=== Point forecast: combined time_bundle → fallback tier merge ===",
        file=sys.stderr,
    )
    combined_tb = "hourly,3_hourly,6_hourly_15day"
    combined = try_fetch_first_bundle(token, lat, lon, combined_tb, 360)
    if combined:
        _n, span_h, vmin, vmax = compute_spire_point_data_stats(combined)
        if span_h >= 200:
            print(
                f"  ✓ combined {combined_tb}: {len(combined)} rows | "
                f"span≈{span_h:.0f}h | {vmin} … {vmax}",
                file=sys.stderr,
            )
            return combined
        print(
            f"  (combined span {span_h:.0f}h < 200h — tier merge)",
            file=sys.stderr,
        )
    else:
        print("  (combined empty — tier merge)", file=sys.stderr)
    return fetch_samui_15day_standard(token, lat, lon)


def build_opf_overlay_map_from_token(token: str) -> Dict[str, Dict[str, float]]:
    if os.environ.get("SPIRE_OPF_ENABLED", "1").lower() in (
        "0",
        "false",
        "no",
        "off",
    ):
        return {}
    loc = opf_location_from_env()
    if not loc:
        return {}
    try:
        fh = int((os.environ.get("SPIRE_OPF_FORECAST_HOURS") or "72").strip())
    except ValueError:
        fh = 72
    fh = min(max(fh, 24), 120)
    raw = fetch_opf_optimized_hourly(token, loc, fh)
    if not raw:
        print(f"[OPF] No data for {loc!r} ({fh}h)", file=sys.stderr)
        return {}
    m = build_opf_overlay_map(raw)
    print(
        f"[OPF] {len(raw)} optimized rows → {len(m)} timesteps with probabilities",
        file=sys.stderr,
    )
    return m


def test_15day_sea_location(token: str) -> List[Dict[str, Any]]:
    """
    Maritime sanity check: Point API on open sea south of Singapore.
    Same tiers/merge as production; no Supabase (only when run() has TEST_15DAY_SEA=1).
    """
    lat, lon = 1.25, 103.80
    print(
        f"=== Test 15-day STANDARD Point at sea near Singapore ({lat}, {lon}) ===",
        file=sys.stderr,
    )
    long_fh = 360
    layers: List[Tuple[str, List[Dict[str, Any]]]] = []
    label, long_data = fetch_long_spine_layer(token, lat, lon, long_fh)
    print(f"Fetching {label} → {long_fh}h (long spine)", file=sys.stderr)
    if long_data:
        _n, span_h, vmin, vmax = compute_spire_point_data_stats(long_data)
        print(
            f"  ✓ {len(long_data)} rows | span ≈ {span_h / 24.0:.1f} days | "
            f"{vmin} … {vmax}",
            file=sys.stderr,
        )
    else:
        print("  ✗ long spine: empty", file=sys.stderr)
    layers.append((label, long_data))

    for label2, time_bundle, fh in (
        ("3_hourly", "3_hourly", 120),
        ("hourly", "hourly", 48),
    ):
        print(f"Fetching {label2} → {fh}h ({time_bundle})", file=sys.stderr)
        try:
            data = try_fetch_first_bundle(token, lat, lon, time_bundle, fh)
        except Exception as e:
            print(f"  ✗ {label2} error: {e}", file=sys.stderr)
            data = []
        if data:
            _n, span_h, vmin, vmax = compute_spire_point_data_stats(data)
            print(
                f"  ✓ {len(data)} rows | span ≈ {span_h / 24.0:.1f} days | "
                f"{vmin} … {vmax}",
                file=sys.stderr,
            )
        else:
            print(f"  ✗ {label2}: empty", file=sys.stderr)
        layers.append((label2, data))

    merged = merge_spire_contract_tiers(layers)
    if merged:
        _n, span_h, fvt, lvt = compute_spire_point_data_stats(merged)
        print(
            f"\n✅ FINAL MERGED: {len(merged)} rows | span ≈ {span_h / 24.0:.1f} days "
            f"({span_h:.0f}h) | {fvt} … {lvt}",
            file=sys.stderr,
        )
    else:
        print("\n❌ No data after merge", file=sys.stderr)
    return merged


def lat_lon_to_tile_fraction(
    lat: float, lon: float, z: int
) -> Tuple[int, int, float, float]:
    """Web Mercator tile + in-tile pixel coords (matches RainViewer / map overlay)."""
    n = 2**z
    x = ((lon + 180) / 360) * n
    lat_rad = math.radians(lat)
    y = ((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2) * n
    x_tile = int(math.floor(x))
    y_tile = int(math.floor(y))
    fx = (x - x_tile) * RADAR_TILE_PX
    fy = (y - y_tile) * RADAR_TILE_PX
    return x_tile, y_tile, fx, fy


def pixel_looks_like_echo(r: int, g: int, b: int, a: int) -> bool:
    """Port of lib/rainviewer-tile-sample.ts — coloured pixels ≈ precipitation."""
    if a < 12:
        return False
    if r > 248 and g > 248 and b > 248:
        return False
    s = r + g + b
    if s > 735 and max(r, g, b) - min(r, g, b) < 18:
        return False
    return True


def latest_radar_frame_path(payload: Dict[str, Any]) -> Optional[str]:
    past = payload.get("radar") or {}
    if not isinstance(past, dict):
        return None
    frames = past.get("past")
    if not isinstance(frames, list) or not frames:
        return None
    sorted_frames = sorted(
        (f for f in frames if isinstance(f, dict) and f.get("path")),
        key=lambda f: int(f.get("time") or 0),
    )
    if not sorted_frames:
        return None
    p = sorted_frames[-1].get("path")
    return str(p).lstrip("/") if p else None


def _rainviewer_log(msg: str) -> None:
    print(f"[RainViewer] {msg}", file=sys.stderr)


def fetch_rainviewer_echo_sample(lat: float, lon: float) -> RainEchoSample:
    """
    Sample z7 / 512px tile at lat/lon (RainViewer scheme 2, 1_1.png).
    Returns precip | none | unknown.
    """
    if Image is None:
        _rainviewer_log("Pillow not installed; cannot decode radar tiles.")
        return "unknown"
    try:
        r = requests.get(
            "https://api.rainviewer.com/public/weather-maps.json",
            headers={"User-Agent": USER_AGENT},
            timeout=30,
        )
        r.raise_for_status()
        j = r.json()
        if not isinstance(j, dict):
            _rainviewer_log("weather-maps.json top-level is not a JSON object.")
            return "unknown"
        path = latest_radar_frame_path(j)
        if not path:
            _rainviewer_log("No usable radar.past frame path in weather-maps.json.")
            return "unknown"
        x_tile, y_tile, fx, fy = lat_lon_to_tile_fraction(lat, lon, RADAR_TILE_Z)
        # path is already e.g. v2/radar/{frameId} (from weather-maps `path`, leading / stripped) —
        # do not prefix v2/radar/ again (would 400 on tilecache).
        url = (
            f"https://tilecache.rainviewer.com/{path}/512/"
            f"{RADAR_TILE_Z}/{x_tile}/{y_tile}/2/1_1.png"
        )
        tr = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
        if not tr.ok:
            _rainviewer_log(
                f"Tile request failed: HTTP {tr.status_code} "
                f"(z={RADAR_TILE_Z} tile=({x_tile},{y_tile}) lat={lat:.4f} lon={lon:.4f})."
            )
            return "unknown"
        im = Image.open(BytesIO(tr.content)).convert("RGBA")
        px = im.load()
        half = 3
        for dy in range(-half, half + 1):
            for dx in range(-half, half + 1):
                ix = int(round(fx + dx))
                iy = int(round(fy + dy))
                if ix < 0 or iy < 0 or ix >= RADAR_TILE_PX or iy >= RADAR_TILE_PX:
                    continue
                pr, pg, pb, pa = px[ix, iy]
                if pixel_looks_like_echo(pr, pg, pb, pa):
                    _rainviewer_log(
                        f"Echo at pin (z={RADAR_TILE_Z} tile=({x_tile},{y_tile}) "
                        f"sample px=({ix},{iy}))."
                    )
                    return "precip"
        _rainviewer_log(
            f"No echo in 7x7 sample around pin "
            f"(z={RADAR_TILE_Z} tile=({x_tile},{y_tile}) fx={fx:.1f} fy={fy:.1f}) -> clear."
        )
        return "none"
    except requests.RequestException as e:
        _rainviewer_log(f"HTTP error: {e!r}")
        return "unknown"
    except Exception as e:
        _rainviewer_log(f"{type(e).__name__}: {e}")
        return "unknown"


def echo_sample_to_radar_fields(sample: RainEchoSample) -> Tuple[RadarStatus, bool]:
    if sample == "precip":
        return "rain", True
    if sample == "none":
        return "clear", False
    return "unknown", False


def parse_spire_rows(payload: Any) -> List[Dict[str, Any]]:
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
        if not isinstance(times, dict):
            continue
        vt = times.get("valid_time")
        if not vt:
            continue
        it = times.get("issuance_time")
        vals = entry.get("values")
        if not isinstance(vals, dict):
            vals = {}
        out.append(
            {
                "valid_time": str(vt),
                "issuance_time": str(it) if it else None,
                "values": vals,
            }
        )
    return out


def pct_cloud(v: Dict[str, Any], *keys: str) -> float:
    x = pick_num(v, keys)
    if x is None:
        return 0.0
    if 0 <= x <= 1.0:
        return x * 100.0
    return max(0.0, min(100.0, x))


def calculate_beach_score(
    values: Dict[str, Any],
    air_c: Optional[float],
    radar_rain: bool,
) -> float:
    """
    0.0–10.0: penalties for low cloud, thunder PoP > 20%, ceiling < 1000 m;
    +0.5 bonus if 28°C <= T <= 32°C; −3 when RainViewer shows echo at the pin.
    """
    s = 10.0
    low = pct_cloud(
        values,
        "low_cloud_cover",
        "cloud_cover_low",
        "low_level_cloud_cover",
    )
    s -= (low / 100.0) * 2.5

    p_th = as_probability_percent(pick_num(values, ("probability_of_thunderstorm",)))
    if p_th > 20.0:
        s -= 1.75

    ceiling = pick_num(values, ("ceiling", "cloud_ceiling", "height_of_cloud_base_above_ground_level"))
    if ceiling is not None and ceiling < 1000:
        s -= 1.5

    if air_c is not None and 28.0 <= air_c <= 32.0:
        s += 0.5

    if radar_rain:
        s -= 3.0

    return max(0.0, min(10.0, round(s, 2)))


def pick_prob_pct(
    v: Dict[str, Any],
    keys: Tuple[str, ...],
) -> Optional[float]:
    x = pick_num(v, keys)
    if x is None:
        return None
    return normalize_prob_percent(float(x))


def flatten_for_db(
    location_id: str,
    m: Dict[str, Any],
    radar_status: RadarStatus,
    radar_rain: bool,
) -> Dict[str, Any]:
    v = m["values"]
    vt_iso = m["valid_time"]
    dt_utc = datetime.fromisoformat(vt_iso.replace("Z", "+00:00"))
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=timezone.utc)

    air_k = pick_num(v, ("air_temperature",))
    air_c = k_to_c(air_k) if air_k is not None else None

    issuance_iso = m.get("issuance_time")
    issuance_utc = None
    if issuance_iso:
        try:
            idt = datetime.fromisoformat(str(issuance_iso).replace("Z", "+00:00"))
            if idt.tzinfo is None:
                idt = idt.replace(tzinfo=timezone.utc)
            issuance_utc = idt.astimezone(timezone.utc).isoformat()
        except Exception:
            issuance_utc = None

    low = pick_num(
        v,
        (
            "low_cloud_cover",
            "cloud_cover_low",
            "low_level_cloud_cover",
        ),
    )
    mid = pick_num(
        v,
        (
            "medium_cloud_cover",
            "mid_cloud_cover",
            "cloud_cover_mid",
            "mid_level_cloud_cover",
        ),
    )
    high = pick_num(
        v,
        (
            "high_cloud_cover",
            "cloud_cover_high",
            "high_level_cloud_cover",
        ),
    )

    beach = calculate_beach_score(v, air_c, radar_rain)

    return {
        "location_id": location_id,
        "valid_time_utc": dt_utc.astimezone(timezone.utc).isoformat(),
        "valid_time_ict": to_ict_label(vt_iso),
        "issuance_time_utc": issuance_utc,
        "air_temperature_c": air_c,
        "wind_speed_ms": pick_num(v, ("wind_speed",)),
        "wind_direction_deg": pick_num(v, ("wind_direction",)),
        "wind_gust_ms": pick_num(v, ("wind_gust",)),
        "total_cloud_cover": pick_num(v, ("total_cloud_cover", "cloud_cover")),
        "low_cloud_cover": low,
        "mid_cloud_cover": mid,
        "high_cloud_cover": high,
        "ceiling_m": pick_num(v, ("ceiling",)),
        "cape": pick_num(
            v,
            ("cape", "CAPE", "convective_available_potential_energy"),
        ),
        "lifted_index": pick_num(v, ("lifted_index", "lifted_index_500")),
        "pwat": pick_num(
            v,
            (
                "precipitable_water",
                "precipitable_water_entire_atmosphere",
                "total_column_integrated_water_vapour",
                "tcw",
            ),
        ),
        "dcape": pick_num(
            v,
            ("downdraft_cape", "downdraft_CAPE", "dcape"),
        ),
        "cin": pick_num(
            v,
            ("convective_inhibition", "cin", "CIN"),
        ),
        "probability_of_precipitation_1hr": pick_prob_pct(
            v,
            (
                "probability_of_precipitation_1hr",
                "probability_of_precipitation",
                "pop",
            ),
        ),
        "probability_of_precipitation_24hr": pick_prob_pct(
            v,
            ("probability_of_precipitation_24hr",),
        ),
        "probability_of_thunderstorm": pick_prob_pct(
            v,
            ("probability_of_thunderstorm",),
        ),
        "probability_of_fog": pick_prob_pct(
            v,
            ("probability_of_fog", "fog_probability"),
        ),
        "precipitation_rate": pick_num(v, ("precipitation_rate",)),
        "relative_humidity": pick_num(v, ("relative_humidity",)),
        "values_json": v,
        "beach_score": beach,
        "radar_status": radar_status,
    }


def forecast_lead_hours(valid_time: str, issuance_time: str) -> float:
    """Return deterministic UTC valid-minus-issuance lead time."""
    valid = datetime.fromisoformat(valid_time.replace("Z", "+00:00"))
    issued = datetime.fromisoformat(issuance_time.replace("Z", "+00:00"))
    if valid.tzinfo is None:
        valid = valid.replace(tzinfo=timezone.utc)
    if issued.tzinfo is None:
        issued = issued.replace(tzinfo=timezone.utc)
    return round((valid.astimezone(timezone.utc) - issued.astimezone(timezone.utc)).total_seconds() / 3600, 6)


def build_forecast_snapshot_row(
    location_id: str,
    request_lat: float,
    request_lon: float,
    forecast_row: Dict[str, Any],
    retrieved_at: str,
    opf_overlay_applied: bool,
) -> Dict[str, Any]:
    """Build one append-only provenance row from the already fetched response."""
    valid_time = str(forecast_row["valid_time"])
    spire_issuance = forecast_row.get("issuance_time")
    issuance_source = "spire" if spire_issuance else "retrieval_fallback"
    issuance_time = str(spire_issuance or retrieved_at)
    flat = forecast_row["flat"]

    source_composition = {
        "standard_point": {
            "endpoint": "/forecast/point",
            "bundles_requested": spire_bundle_chain(),
            "time_bundle": "hourly,3_hourly,6_hourly_15day",
            "forecast_hours": 360,
            "product": (os.environ.get("SPIRE_FORECAST_PRODUCT") or "").strip() or None,
            "unit_system": (os.environ.get("SPIRE_FORECAST_UNIT_SYSTEM") or "").strip() or None,
        },
        "optimized_point_probability_overlay": {
            "endpoint": "/forecast/point/optimized",
            "location": opf_location_from_env(),
            "bundles_requested": [
                b
                for b in (
                    (os.environ.get("SPIRE_OPF_BUNDLES") or "").strip(),
                    "basic,thunderstorm",
                    "basic",
                )
                if b
            ],
            "time_bundle": "hourly",
            "forecast_hours": 72,
            "product": (os.environ.get("SPIRE_FORECAST_PRODUCT") or "").strip() or None,
            "unit_system": (os.environ.get("SPIRE_FORECAST_UNIT_SYSTEM") or "").strip() or None,
            "applied_to_this_row": opf_overlay_applied,
        },
    }
    try:
        source_composition["optimized_point_probability_overlay"]["forecast_hours"] = min(
            max(int((os.environ.get("SPIRE_OPF_FORECAST_HOURS") or "72").strip()), 24),
            120,
        )
    except ValueError:
        pass

    content_for_hash = {
        "location_id": location_id,
        "valid_time_utc": valid_time,
        "issuance_time_utc": issuance_time,
        "values_json": flat["values_json"],
        "normalized": {
            key: flat.get(key)
            for key in (
                "air_temperature_c",
                "wind_speed_ms",
                "wind_direction_deg",
                "wind_gust_ms",
                "total_cloud_cover",
                "low_cloud_cover",
                "mid_cloud_cover",
                "high_cloud_cover",
                "ceiling_m",
                "cape",
                "lifted_index",
                "pwat",
                "dcape",
                "cin",
                "probability_of_precipitation_1hr",
                "probability_of_precipitation_24hr",
                "probability_of_thunderstorm",
                "probability_of_fog",
                "precipitation_rate",
                "relative_humidity",
            )
        },
    }
    snapshot_hash = hashlib.sha256(
        json.dumps(content_for_hash, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()

    return {
        "source_provider": "spire",
        "source_product": "standard_point_plus_optimized_point_probability_overlay",
        "source_composition": source_composition,
        "source_version": "weather_engine_hourly_snapshot_v1",
        "location_id": location_id,
        "request_latitude": request_lat,
        "request_longitude": request_lon,
        "retrieved_at_utc": retrieved_at,
        "issuance_time_utc": issuance_time,
        "issuance_time_source": issuance_source,
        "valid_time_utc": flat["valid_time_utc"],
        "forecast_lead_hours": forecast_lead_hours(flat["valid_time_utc"], issuance_time),
        **{
            key: flat.get(key)
            for key in (
                "air_temperature_c",
                "wind_speed_ms",
                "wind_direction_deg",
                "wind_gust_ms",
                "total_cloud_cover",
                "low_cloud_cover",
                "mid_cloud_cover",
                "high_cloud_cover",
                "ceiling_m",
                "cape",
                "lifted_index",
                "pwat",
                "dcape",
                "cin",
                "probability_of_precipitation_1hr",
                "probability_of_precipitation_24hr",
                "probability_of_thunderstorm",
                "probability_of_fog",
                "precipitation_rate",
                "relative_humidity",
            )
        },
        "values_json": flat["values_json"],
        "opf_overlay_applied": opf_overlay_applied,
        "snapshot_hash": snapshot_hash,
    }


def coerce_whole_floats_for_postgres(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Supabase/Postgres integer columns reject JSON floats like 5.0; convert
    whole-number floats to int for top-level fields (not values_json).
    """
    out = dict(row)
    for key, v in list(out.items()):
        if key == "values_json":
            continue
        if isinstance(v, float) and v.is_integer():
            out[key] = int(v)
    return out


def _exception_text(exc: BaseException) -> str:
    """All printable parts of an exception; PostgREST `APIError` may hide details in `str()` only."""
    parts: list[str] = [str(exc), repr(exc)]
    try:
        a = getattr(exc, "args", None)
        if a:
            parts.append(" ".join(repr(x) for x in a))
    except Exception:
        pass
    for name in ("message", "code", "details", "hint"):
        if hasattr(exc, name):
            parts.append(str(getattr(exc, name) or ""))
    return "\n".join(parts)


def print_ingest_summary(payload: Dict[str, Any]) -> None:
    line = "INGEST_SUMMARY " + json.dumps(payload, default=str)
    print(line)
    print(line, file=sys.stderr)


def skip_if_fresh_minutes() -> Optional[int]:
    if os.environ.get("FORCE_INGEST", "").lower() in ("1", "true", "yes"):
        return None
    raw = (os.environ.get("SKIP_IF_FRESH_MINUTES") or "").strip()
    if not raw:
        return 50
    try:
        n = int(raw)
    except ValueError:
        return 50
    return n if n > 0 else None


def latest_updated_at(sb: Client, location_id: str) -> Optional[datetime]:
    try:
        res = (
            sb.table("weather_forecast")
            .select("updated_at")
            .eq("location_id", location_id)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = getattr(res, "data", None) or []
        if not rows:
            return None
        raw = rows[0].get("updated_at")
        if not raw:
            return None
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except Exception as e:
        print(f"[WARN] could not read last ingest time: {e}", file=sys.stderr)
        return None


def get_supabase() -> Client:
    if create_client is None:
        raise RuntimeError("Install supabase: pip install supabase")
    url = (os.environ.get("SUPABASE_URL") or "").strip()
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_KEY")
        or ""
    ).strip()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) required")
    return create_client(url, key)


def run() -> int:
    load_env()
    print(
        "weather_engine_hourly.py ingest_build=probability_of_fog-column-014+",
        file=sys.stderr,
    )
    dry = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")
    token = (os.environ.get("SPIRE_API_TOKEN") or os.environ.get("SPIRE_API_KEY") or "").strip()
    if not token:
        print("Missing SPIRE_API_TOKEN", file=sys.stderr)
        return 1

    if os.environ.get("TEST_15DAY_SEA", "").lower() in ("1", "true", "yes"):
        test_15day_sea_location(token)
        return 0

    location_id = (os.environ.get("WEATHER_LOCATION_ID") or "samui_opf_hybrid").strip()
    if os.environ.get("FORECAST_HOURS"):
        print(
            "[NOTE] FORECAST_HOURS is ignored; horizons follow lib/spire.ts (360 + 120 + 48, long spine 6_hourly_15day).",
            file=sys.stderr,
        )
    try:
        lat = float(os.environ.get("SAMUI_LAT") or str(SAMUI_LAT))
        lon = float(os.environ.get("SAMUI_LON") or str(SAMUI_LON))
    except ValueError:
        lat, lon = SAMUI_LAT, SAMUI_LON

    sb: Optional[Client] = None
    if not dry:
        if create_client is None:
            print("Install supabase package.", file=sys.stderr)
            return 1
        try:
            sb = get_supabase()
        except Exception as e:
            print(e, file=sys.stderr)
            return 1
        skip_min = skip_if_fresh_minutes()
        if skip_min is not None:
            last = latest_updated_at(sb, location_id)
            if last is not None:
                if last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                age_m = (datetime.now(timezone.utc) - last.astimezone(timezone.utc)).total_seconds() / 60.0
                if age_m < skip_min:
                    print_ingest_summary(
                        {
                            "skipped": True,
                            "reason": "fresh",
                            "location_id": location_id,
                            "lat": lat,
                            "lon": lon,
                            "updated_at": last.isoformat(),
                            "age_minutes": round(age_m, 1),
                            "skip_if_fresh_minutes": skip_min,
                        }
                    )
                    print(
                        f"Skip Spire fetch: last ingest {age_m:.1f} min ago (< {skip_min}).",
                        file=sys.stderr,
                    )
                    return 0
        try:
            arch = sb.rpc(
                "archive_expired_forecasts", {"p_location_id": location_id}
            ).execute()
            raw = getattr(arch, "data", None)
            n_arch = raw[0] if isinstance(raw, list) and raw else raw
            print(f"Archived expired rows: {n_arch}")
        except Exception as e:
            print(
                f"[WARN] archive_expired_forecasts RPC failed "
                f"(e.g. run supabase/015_weather_history_valid_time_ict_for_archive.sql "
                f"in Supabase SQL Editor, or full 007+008+010): {e}",
                file=sys.stderr,
            )

    echo = fetch_rainviewer_echo_sample(lat, lon)
    radar_status, radar_rain = echo_sample_to_radar_fields(echo)
    print(f"RainViewer sample: {echo} -> radar_status={radar_status}")

    try:
        with ThreadPoolExecutor(max_workers=2) as ex:
            fut_point = ex.submit(fetch_samui_point_forecast, token, lat, lon)
            fut_opf = ex.submit(build_opf_overlay_map_from_token, token)
            merged_raw = fut_point.result()
            opf_overlay = fut_opf.result()
    except Exception as e:
        print(f"[ERROR] Spire contract merge failed: {e}", file=sys.stderr)
        traceback.print_exc()
        return 1

    if not merged_raw:
        print("[ERROR] Spire contract merge returned no rows.", file=sys.stderr)
        return 1

    merged = parse_spire_rows({"data": merged_raw})
    if not merged:
        print("[ERROR] No rows after parse_spire_rows.", file=sys.stderr)
        return 1

    overlay_opf_probabilities(merged, opf_overlay)

    _n, span_h, first_vt, last_vt = compute_spire_point_data_stats(merged_raw)
    print(
        f"Spire contract merge: {len(merged)} rows, span≈{span_h:.1f}h "
        f"({first_vt} … {last_vt})."
    )

    rows_out: List[Dict[str, Any]] = []
    snapshot_rows: List[Dict[str, Any]] = []
    retrieved_at = datetime.now(timezone.utc).isoformat()
    for m in merged:
        flat = flatten_for_db(location_id, m, radar_status, radar_rain)
        rows_out.append(flat)
        snapshot_rows.append(
            build_forecast_snapshot_row(
                location_id,
                lat,
                lon,
                {**m, "flat": flat},
                retrieved_at,
                normalize_time_key(str(m["valid_time"])) in opf_overlay,
            )
        )

    print(f"Upsert-ready {len(rows_out)} rows (aligned with lib/spire.ts).")
    if dry:
        print(json.dumps(rows_out[:3], indent=2, default=str))
        print("... DRY_RUN: skip Supabase upsert.")
        return 0

    assert sb is not None

    now_iso = datetime.now(timezone.utc).isoformat()
    payload: List[Dict[str, Any]] = []
    for r in rows_out:
        row = coerce_whole_floats_for_postgres(dict(r))
        row["updated_at"] = now_iso
        payload.append(row)

    try:
        sb.table("weather_forecast_snapshot").upsert(
            snapshot_rows,
            on_conflict="location_id,valid_time_utc,issuance_time_utc",
        ).execute()
        print(f"Upserted/deduped {len(snapshot_rows)} rows into weather_forecast_snapshot.")
    except Exception as e:
        print(f"[ERROR] Forecast snapshot upsert failed: {e}", file=sys.stderr)
        print(_exception_text(e), file=sys.stderr)
        traceback.print_exc()
        return 1

    try:
        sb.table("weather_forecast").upsert(
            payload,
            on_conflict="location_id,valid_time_utc",
        ).execute()
        print(f"Upserted {len(payload)} rows into weather_forecast.")
    except Exception as e:
        print(f"[ERROR] Upsert failed: {e}", file=sys.stderr)
        print(_exception_text(e), file=sys.stderr)
        traceback.print_exc()
        return 1

    print_ingest_summary(
        {
            "skipped": False,
            "location_id": location_id,
            "lat": lat,
            "lon": lon,
            "row_count": len(payload),
            "first_valid_time": first_vt,
            "last_valid_time": last_vt,
            "updated_at": now_iso,
            "radar_status": radar_status,
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(run())
