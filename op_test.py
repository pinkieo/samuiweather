import os
import requests
from dotenv import load_dotenv

# 1. Laden van de omgevingsvariabelen
load_dotenv(".env")
load_dotenv(".env.local", override=True)
token = os.getenv("SPIRE_API_TOKEN")

# 2. Configuratie voor Optimized Point
LOCATION_ID = "custom:PR_W1XNKK0"  # De nieuwe Samui ID van Gerald
BASE_URL = "https://api.wx.spire.com/forecast/point/optimized"

params = {
    "location": LOCATION_ID,
    "time_bundle": "hourly",
    "bundle": "basic,maritime-atmos,clouds,thunderstorm" 
}

headers = {
    "spire-api-key": token or ""
}

print(f"--- Spire Optimized Point Diagnostic ---")
print(f"Location ID: {LOCATION_ID}")
print(f"Endpoint:    {BASE_URL}")
print("----------------------------------------")

try:
    # 3. De Request
    response = requests.get(BASE_URL, headers=headers, params=params, timeout=30)
    
    if response.status_code == 200:
        payload = response.json()
        rows = payload.get("data", [])
        
        if not rows:
            print("FOUT: Verbinding gelukt, maar geen data gevonden voor dit ID.")
        else:
            # We pakken de eerste rij (meestal de meest actuele voorspelling)
            first_row = rows[0]
            v = first_row.get("values", {})
            
            print(f"Data ontvangen voor tijdstip: {first_row.get('valid_time')}")
            print(f"\n[CLOUD BUNDLE]")
            # We gebruiken .get(key, 'N/A') om duidelijk te zien of een veld ontbreekt
            print(f"Total Cloud Cover: {v.get('total_cloud_cover', 'N/A')}%")
            print(f"Low Cloud Cover:   {v.get('low_cloud_cover', 'N/A')}%")
            print(f"Cloud Ceiling:     {v.get('cloud_ceiling_height', 'N/A')} m")
            
            print(f"\n[THUNDERSTORM BUNDLE]")
            print(f"CAPE:              {v.get('cape', 'N/A')} J/kg")
            print(f"Lifted Index:      {v.get('lifted_index', 'N/A')}")
            print(f"DCAPE:             {v.get('downward_convective_available_potential_energy', 'N/A')}")
            
            print(f"\n[DEBUG INFO]")
            print(f"Totaal aantal beschikbare parameters: {len(v.keys())}")
            # Laat de eerste 15 keys zien om te checken of de namen zijn veranderd
            print("Beschikbare keys (selectie):", sorted(v.keys())[:15])
            
    else:
        print(f"FOUTMELDING: Status {response.status_code}")
        print(f"Response van Spire: {response.text}")

except Exception as e:
    print(f"Script error: {e}")