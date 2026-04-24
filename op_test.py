import os
import requests
from dotenv import load_dotenv

# 1. Load environment variables
load_dotenv(".env")
load_dotenv(".env.local", override=True)
token = os.getenv("SPIRE_API_TOKEN")

# 2. Optimized Point config
LOCATION_ID = "custom:PR_W1XNKK0"  # Samui ID from Gerald
BASE_URL = "https://api.wx.spire.com/forecast/point/optimized"

params = {
    "location": LOCATION_ID,
    "time_bundle": "hourly",
    "bundle": "basic,maritime-atmos,clouds,thunderstorm"
}

headers = {
    "spire-api-key": token or ""
}

print("--- Spire Optimized Point Diagnostic ---")
print(f"Location ID: {LOCATION_ID}")
print(f"Endpoint:    {BASE_URL}")
print("----------------------------------------")

try:
    # 3. Request
    response = requests.get(BASE_URL, headers=headers, params=params, timeout=30)

    if response.status_code == 200:
        payload = response.json()
        rows = payload.get("data", [])

        if not rows:
            print("ERROR: Connection OK but no data for this ID.")
        else:
            # First row (usually the most current forecast)
            first_row = rows[0]
            v = first_row.get("values", {})

            print(f"Data for valid time: {first_row.get('valid_time')}")
            print("\n[CLOUD BUNDLE]")
            # .get(key, 'N/A') makes missing fields obvious
            print(f"Total Cloud Cover: {v.get('total_cloud_cover', 'N/A')}%")
            print(f"Low Cloud Cover:   {v.get('low_cloud_cover', 'N/A')}%")
            print(f"Cloud Ceiling:     {v.get('cloud_ceiling_height', 'N/A')} m")

            print(f"\n[THUNDERSTORM BUNDLE]")
            print(f"CAPE:              {v.get('cape', 'N/A')} J/kg")
            print(f"Lifted Index:      {v.get('lifted_index', 'N/A')}")
            print(f"DCAPE:             {v.get('downward_convective_available_potential_energy', 'N/A')}")

    else:
        print(f"HTTP {response.status_code}: {response.text[:500]}")

except Exception as e:
    print(f"ERROR: {e}")
