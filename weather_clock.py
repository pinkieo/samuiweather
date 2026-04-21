import os
import requests
from supabase import create_client

# Haal de geheimen op uit de GitHub omgeving
SPIRE_TOKEN = os.getenv("SPIRE_API_TOKEN")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def main():
    print("Start weather update...")
    # Hier komt de rest van je code die de data ophaalt en naar Supabase stuurt
    # ...
    print("Update succesvol!")

if __name__ == "__main__":
    main()