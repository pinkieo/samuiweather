import os
import math
from datetime import datetime, timezone
import requests
from dotenv import load_dotenv

load_dotenv(".env")
load_dotenv(".env.local", override=True)
token = os.getenv("SPIRE_API_TOKEN")

BASE = "https://api.wx.spire.com"
url = f"{BASE}/tides/point"

start_dt = datetime.now(timezone.utc).replace(microsecond=0)
start_datetime = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

params = {
    "lat": 9.5120,
    "lon": 100.0136,
    "start_datetime": start_datetime,
    "forecast_hours": 720, # 30 dagen
}

headers = {
    "spire-api-key": token or "",
}

def tide_height_v4(values) -> tuple:
    if values is None: return None, None
    if isinstance(values, dict):
        for key in ("tide_height", "height"):
            v = values.get(key)
            if isinstance(v, (int, float)): return v, key
        return None, None
    if isinstance(values, list):
        for item in values:
            if not isinstance(item, dict): continue
            if item.get("name") == "tide_height":
                for key in ("value", "data", "tide_height"):
                    v = item.get(key)
                    if isinstance(v, (int, float)): return v, key
            for key in ("tide_height", "height"):
                v = item.get(key)
                if isinstance(v, (int, float)): return v, key
        return None, None
    return None, None

print(f"Ophalen 30 dagen (720 uur) forecast voor {params['lat']}, {params['lon']}...")
response = requests.get(url, headers=headers, params=params, timeout=60)
response.raise_for_status()

payload = response.json()
rows = payload.get("data") or []

series_y = []
for row in rows:
    h, _ = tide_height_v4(row.get("values"))
    if h is not None:
        series_y.append(h)

if not series_y:
    print("Geen data gevonden!")
    exit(1)

max_val = max(series_y)
min_val = min(series_y)
mean_val = sum(series_y) / len(series_y)

series_y_sorted = sorted(series_y)
# 85th percentile (top 15%)
p85_idx = int(len(series_y_sorted) * 0.85)
p85_val = series_y_sorted[p85_idx]

# 95th percentile (top 5%)
p95_idx = int(len(series_y_sorted) * 0.95)
p95_val = series_y_sorted[p95_idx]

print(f"--- Samui Tides Analysis (30 days) ---")
print(f"Aantal metingen: {len(series_y)} uur")
print(f"Min: {min_val:.3f} m")
print(f"Gemiddelde (MSL): {mean_val:.3f} m")
print(f"Max: {max_val:.3f} m")
print()
print(f"Top 15% Drempel (Beach Disappearing): {p85_val:.3f} m")
print(f"Top 5% Drempel (Deep Water): {p95_val:.3f} m")
