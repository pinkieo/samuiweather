import requests

TOKEN = "c2be2bddd5d9bfe44ae5e0a141550aa51ac20080"
LAT = 9.5120
LON = 100.0137

url = f"https://api.waqi.info/feed/geo:{LAT};{LON}/?token={TOKEN}"

response = requests.get(url)
data = response.json()

if data['status'] == 'ok':
    print(f"✅ AQICN Token werkt! AQI op Samui: {data['data']['aqi']}")
else:
    print(f"❌ AQICN Fout: {data['data']}")