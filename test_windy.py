import requests

# Vul hier je tokens in
MAPS_TOKEN = "JOUW_MAPS_TOKEN"
FORECAST_TOKEN = "JOUW_FORECAST_TOKEN"

def test_windy_services():
    print("🚀 Start Windy Silver Connectivity Test...")

    # 1. Test de Maps API (De visuele kaart)
    # We proberen de kaart-bibliotheek op te halen met jouw key
    maps_url = f"https://api.windy.com/assets/map-forecast/lib/index.js?key={MAPS_TOKEN}"
    try:
        r_maps = requests.get(maps_url)
        if r_maps.status_code == 200:
            print("✅ Maps API: SUCCESS (200) - Je key is geldig voor kaartgebruik.")
        else:
            print(f"❌ Maps API: FAILED ({r_maps.status_code}) - {r_maps.text[:100]}")
    except Exception as e:
        print(f"❌ Maps API: Error: {e}")

    print("-" * 30)

    # 2. Test de Forecast API (De data)
    # We gebruiken het 'gfs' model omdat dit bijna altijd in Silver zit
    forecast_url = "https://api.windy.com/api/point-forecast/v2"
    payload = {
        "lat": 9.512,
        "lon": 100.0136,
        "model": "gfs", 
        "parameters": ["temp", "precip"],
        "levels": ["surface"]
    }
    headers = {"key": FORECAST_TOKEN}

    try:
        r_forecast = requests.post(forecast_url, json=payload, headers=headers)
        if r_forecast.status_code == 200:
            print("✅ Forecast API: SUCCESS (200) - Je kunt data ophalen.")
        elif r_forecast.status_code == 400:
            print(f"⚠️ Forecast API: Bad Request (400). Dit komt vaak door model-beperkingen.")
            print(f"   Response: {r_forecast.text}")
        else:
            print(f"❌ Forecast API: FAILED ({r_forecast.status_code}) - {r_forecast.text}")
    except Exception as e:
        print(f"❌ Forecast API: Error: {e}")

if __name__ == "__main__":
    test_windy_services()