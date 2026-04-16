import requests

API_KEY = "openuv-7uzrmnwjabml-io"
LAT = 9.5120
LON = 100.0137

headers = {
    'x-access-token': API_KEY,
    'content-type': 'application/json'
}

url = f"https://api.openuv.io/api/v1/uv?lat={LAT}&lng={LON}"

response = requests.get(url, headers=headers)

if response.status_code == 200:
    data = response.json()
    print(f"✅ OpenUV Token werkt! Actuele UV: {data['result']['uv']}")
else:
    print(f"❌ OpenUV Fout {response.status_code}: {response.text}")