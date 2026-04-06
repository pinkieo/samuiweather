import os
import requests
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("SPIRE_API_TOKEN")

# De meest stabiele 'Global' route voor oudere contracten
url = "https://api.spire.com/forecast/point"

params = {
    "lat": 9.5120,
    "lon": 100.0136,
    "bundles": "basic" # We houden het simpel om 403/404 te vermijden
}

headers = {
    "spire-api-key": token
}

print(f"Checking Global Forecast (Legacy Route)...")
try:
    response = requests.get(url, headers=headers, params=params)
    print("STATUS:", response.status_code)
    
    if response.status_code == 200:
        print("✅ SUCCES! Je 2023/2025 contract is actief.")
        data = response.json()
        # Laat zien welke bundles je daadwerkelijk mag inzien
        if 'data' in data and len(data['data']) > 0:
            print("Beschikbare velden:", list(data['data'][0].keys()))
    else:
        print("RESPONSE:", response.text)
        
        # Test 2: Als de bovenste faalt, proberen we de oude 'wx' subdomein route
        print("\nTest 2: Proberen via wx.spire.com...")
        url_old = "https://api.wx.spire.com/forecast/point"
        res_old = requests.get(url_old, headers=headers, params=params)
        print("ALT STATUS:", res_old.status_code)
        print("ALT RESPONSE:", res_old.text)

except Exception as e:
    print(f"Fout tijdens aanroep: {e}")