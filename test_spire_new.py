import os
import requests
from dotenv import load_dotenv

# 1. Load environment
load_dotenv(".env")
load_dotenv(".env.local", override=True)
token = os.getenv("SPIRE_API_TOKEN")

# 2. Config — standard Point (Optimized returned None before)
BASE_URL = "https://api.wx.spire.com/forecast/point"
LAT = 9.5120
LON = 100.0136

params = {
    "lat": LAT,
    "lon": LON,
    "time_bundle": "hourly",
    "bundle": "basic,maritime-atmos,clouds,thunderstorm"
}

headers = {
    "spire-api-key": token or ""
}

print("--- Spire API Diagnostic Tool ---")
print(f"Target: Standard Point API ({LAT}, {LON})")
print(f"Bundles: {params['bundle']}")
print("---------------------------------")

try:
    response = requests.get(BASE_URL, headers=headers, params=params, timeout=30)

    print(f"HTTP Status Code: {response.status_code}")

    if response.status_code == 200:
        payload = response.json()
        rows = payload.get("data", [])

        if not rows:
            print("ERROR: API returned 200 OK but 'data' is empty.")
            print(f"Full response: {payload}")
        else:
            first_row = rows[0]
            values = first_row.get("values", {})

            print(f"\nOK: Data for {first_row.get('valid_time')}")
            print(f"\n[CLOUD DATA]")
            print(f"Total Cloud Cover: {values.get('total_cloud_cover')}%")
            print(f"Low Cloud Cover:   {values.get('low_cloud_cover')}")
            print(f"Cloud Ceiling:     {values.get('cloud_ceiling_height')}")

            print(f"\n[THUNDERSTORM DATA]")
            print(f"CAPE:              {values.get('cape')}")
            print(f"Lifted Index:      {values.get('lifted_index')}")
            print(f"DCAPE:             {values.get('downward_convective_available_potential_energy')}")

            print(f"\n[DEBUG]")
            print(f"Total keys in JSON: {len(values.keys())}")
            print("First 10 keys:", sorted(values.keys())[:10])

    elif response.status_code == 401 or response.status_code == 403:
        print("AUTH ERROR: Invalid API key or bundles not enabled for this account.")
        print(f"Response: {response.text}")
    else:
        print(f"UNKNOWN ERROR: {response.status_code}")
        print(f"Response: {response.text}")

except Exception as e:
    print(f"Script error: {e}")
