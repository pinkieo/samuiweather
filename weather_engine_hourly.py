#!/usr/bin/env python3
"""
Koh Samui hybrid Spire ingest (hourly cron):
  1. RPC archive_expired_forecasts(p_location_id) — keep weather_forecast clean
  2. Spire OPF + Standard point → merge on valid_time
  3. RainViewer tile sample at pin (same z7/512 scheme as the app)
  4. beach_score (clouds/thunder/ceiling + temp bonus; −3 when radar shows rain)
  5. upsert weather_forecast (incl. radar_status)

Env (.env / .env.local):
  SPIRE_API_TOKEN or SPIRE_API_KEY
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY

Optional:
  WEATHER_LOCATION_ID  (default: samui_opf_hybrid)
  FORECAST_HOURS        (default: 240 ~10 days hourly)
  DRY_RUN=1             (no Supabase writes)
"""

from __future__ import annotations

import json
import math
import os
import sys
import traceback
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, Literal, Optional, Tuple
from zoneinfo import ZoneInfo

try:
    import requests
except ImportError:
    print(
        "Missing deps. Options (from this repo root):\n"
        "  1) Double-click or run:  weather-hourly.cmd   (uses .venv; recommended on Windows)\n"
        "  2)  py -m pip install -r requirements-weather-engine.txt\n"
        "     py -c \"import sys; print(sys.executable)\"   (must match the Python that runs this script)\n",
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

ICT = ZoneInfo("Asia/Bangkok")
SPIRE_BASE = "https://api.wx.spire.com"
OPF_LOCATION = "custom:PR_W1XNKK0"
SAMUI_LAT = 9.5120
SAMUI_LON = 100.0136
USER_AGENT = "SamuiWeatherEngine/1.0"

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


def fetch_rainviewer_echo_sample(lat: float, lon: float) -> RainEchoSample:
    """
    Sample z7 / 512px tile at lat/lon (RainViewer scheme 2, 1_1.png).
    Returns precip | none | unknown.
    """
    if Image is None:
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
            return "unknown"
        path = latest_radar_frame_path(j)
        if not path:
            return "unknown"
        x_tile, y_tile, fx, fy = lat_lon_to_tile_fraction(lat, lon, RADAR_TILE_Z)
        url = (
            f"https://tilecache.rainviewer.com/v2/radar/{path}/512/"
            f"{RADAR_TILE_Z}/{x_tile}/{y_tile}/2/1_1.png"
        )
        tr = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
        if not tr.ok:
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
                    return "precip"
        return "none"
    except Exception:
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


def merge_forecasts(
    opf: Dict[str, Any], std: Dict[str, Any]
) -> List[Dict[str, Any]]:
    op_rows = {
        normalize_time_key(r["valid_time"]): r for r in parse_spire_rows(opf)
    }
    st_rows = {
        normalize_time_key(r["valid_time"]): r for r in parse_spire_rows(std)
    }
    keys = sorted(set(op_rows.keys()) | set(st_rows.keys()))

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
        "probability_of_precipitation_1hr",
        "probability_of_precipitation_24hr",
        "probability_of_thunderstorm",
        "visibility",
        "ceiling",
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
    for vk in keys:
        op = op_rows.get(vk) or {}
        st = st_rows.get(vk) or {}
        ov = dict(op.get("values") or {})
        sv = dict(st.get("values") or {})
        combined = {**sv, **ov}
        for key in opf_priority:
            if key in ov:
                combined[key] = ov[key]
        for key in standard_extra:
            if key in sv:
                combined[key] = sv[key]

        issuance = op.get("issuance_time") or st.get("issuance_time")
        merged.append(
            {
                "valid_time": vk,
                "issuance_time": issuance,
                "values": combined,
            }
        )
    return merged


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

    p_th = pick_num(values, ("probability_of_thunderstorm",)) or 0.0
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
        "probability_of_precipitation_1hr": pick_num(
            v,
            ("probability_of_precipitation_1hr",),
        ),
        "probability_of_precipitation_24hr": pick_num(
            v,
            ("probability_of_precipitation_24hr",),
        ),
        "probability_of_thunderstorm": pick_num(
            v,
            ("probability_of_thunderstorm",),
        ),
        "precipitation_rate": pick_num(v, ("precipitation_rate",)),
        "relative_humidity": pick_num(v, ("relative_humidity",)),
        "values_json": v,
        "beach_score": beach,
        "radar_status": radar_status,
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


def fetch_opf(token: str, hours: int) -> Dict[str, Any]:
    params = {
        "location": OPF_LOCATION,
        "bundles": "basic",
        "time_bundle": "hourly",
        "forecast_hours": str(hours),
    }
    r = requests.get(
        f"{SPIRE_BASE}/forecast/point/optimized",
        params=params,
        headers={"spire-api-key": token, "User-Agent": USER_AGENT},
        timeout=90,
    )
    r.raise_for_status()
    return r.json()


def fetch_standard(token: str, hours: int) -> Dict[str, Any]:
    params = {
        "lat": str(SAMUI_LAT),
        "lon": str(SAMUI_LON),
        "bundles": "clouds,thunderstorm",
        "time_bundle": "hourly",
        "forecast_hours": str(hours),
    }
    r = requests.get(
        f"{SPIRE_BASE}/forecast/point",
        params=params,
        headers={"spire-api-key": token, "User-Agent": USER_AGENT},
        timeout=90,
    )
    r.raise_for_status()
    return r.json()


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
    dry = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")
    token = (os.environ.get("SPIRE_API_TOKEN") or os.environ.get("SPIRE_API_KEY") or "").strip()
    if not token:
        print("Missing SPIRE_API_TOKEN", file=sys.stderr)
        return 1

    location_id = (os.environ.get("WEATHER_LOCATION_ID") or "samui_opf_hybrid").strip()
    hours = int(os.environ.get("FORECAST_HOURS") or "240")
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
                f"(run supabase/007 + 008 SQL?): {e}",
                file=sys.stderr,
            )

    opf: Dict[str, Any] = {}
    std: Dict[str, Any] = {}
    opf_err: Optional[str] = None
    std_err: Optional[str] = None

    try:
        opf = fetch_opf(token, hours)
    except Exception as e:
        opf_err = str(e)
        print(f"[WARN] OPF failed: {opf_err}", file=sys.stderr)

    try:
        std = fetch_standard(token, hours)
    except Exception as e:
        std_err = str(e)
        print(f"[WARN] Standard point failed: {std_err}", file=sys.stderr)

    if not opf and not std:
        print("[ERROR] Both API calls failed.", file=sys.stderr)
        if opf_err:
            traceback.print_exc()
        return 1

    echo = fetch_rainviewer_echo_sample(lat, lon)
    radar_status, radar_rain = echo_sample_to_radar_fields(echo)
    if Image is None:
        print(
            "[WARN] Pillow not installed - radar_status=unknown, no radar penalty.",
            file=sys.stderr,
        )
    print(f"RainViewer sample: {echo} -> radar_status={radar_status}")

    merged = merge_forecasts(opf or {"data": []}, std or {"data": []})
    if not merged:
        print("[ERROR] No merged rows (empty data from Spire).", file=sys.stderr)
        return 1

    rows_out: List[Dict[str, Any]] = []
    for m in merged:
        flat = flatten_for_db(location_id, m, radar_status, radar_rain)
        rows_out.append(flat)

    print(f"Merged {len(rows_out)} hourly rows (forecast_hours={hours}).")
    if dry:
        print(json.dumps(rows_out[:3], indent=2, default=str))
        print("... DRY_RUN: skip Supabase upsert.")
        return 0

    assert sb is not None

    now_iso = datetime.now(timezone.utc).isoformat()
    payload = []
    for r in rows_out:
        row = coerce_whole_floats_for_postgres(dict(r))
        row["updated_at"] = now_iso
        payload.append(row)

    try:
        sb.table("weather_forecast").upsert(
            payload,
            on_conflict="location_id,valid_time_utc",
        ).execute()
        print(f"Upserted {len(payload)} rows into weather_forecast.")
    except Exception as e:
        print(f"[ERROR] Upsert failed: {e}", file=sys.stderr)
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(run())
