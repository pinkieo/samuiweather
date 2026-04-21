import os
import requests
from dotenv import load_dotenv

# 1. Laden van de omgevingsvariabelen
load_dotenv(".env")
load_dotenv(".env.local", override=True)
token = os.getenv("SPIRE_API_TOKEN")

# 2. Configuratie
# We testen nu de STANDAARD endpoint omdat de Optimized Point None gaf.
BASE_URL = "https://api.wx.spire.com/forecast/point" 
LAT = 9.5120
LON = 100.0136

params = {
    "lat": LAT,
    "lon": LON,
    "time_bundle": "hourly", # Specifiek hourly opvragen voor meer detail
    "bundle": "basic,maritime-atmos,clouds,thunderstorm" 
}

headers = {
    "spire-api-key": token or ""
}

print(f"--- Spire API Diagnostic Tool ---")
print(f"Target: Standard Point API ({LAT}, {LON})")
print(f"Bundles: {params['bundle']}")
print("---------------------------------")

try:
    # 3. De Request
    response = requests.get(BASE_URL, headers=headers, params=params, timeout=30)
    
    print(f"HTTP Status Code: {response.status_code}")
    
    # 4. Analyse van het antwoord
    if response.status_code == 200:
        payload = response.json()
        rows = payload.get("data", [])
        
        if not rows:
            print("FOUT: De API geeft een 200 OK, maar de 'data' lijst is LEEG.")
            print(f"Volledige response: {payload}")
        else:
            first_row = rows[0]
            values = first_row.get("values", {})
            
            print(f"\nSUCCES: Data ontvangen voor {first_row.get('valid_time')}")
            print(f"\n[CLOUD DATA]")
            print(f"Total Cloud Cover: {values.get('total_cloud_cover')}%")
            print(f"Low Cloud Cover:   {values.get('low_cloud_cover')}")
            print(f"Cloud Ceiling:     {values.get('cloud_ceiling_height')}")
            
            print(f"\n[THUNDERSTORM DATA]")
            print(f"CAPE:              {values.get('cape')}")
            print(f"Lifted Index:      {values.get('lifted_index')}")
            print(f"DCAPE:             {values.get('downward_convective_available_potential_energy')}")
            
            print(f"\n[DEBUG]")
            print(f"Totaal aantal keys in JSON: {len(values.keys())}")
            print("Eerste 10 keys:", sorted(values.keys())[:10])
            
    elif response.status_code == 401 or response.status_code == 403:
        print("AUTORISATIE FOUT: De API key is ongeldig of de bundles zijn niet actief voor dit account.")
        print(f"Response: {response.text}")
    else:
        print(f"ONBEKENDE FOUT: {response.status_code}")
        print(f"Response: {response.text}")

except Exception as e:
    print(f"Er is een fout opgetreden tijdens het runnen van het script: {e}")