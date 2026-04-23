# Samui Weather Pro
Live op: samuiweather.com

## Updates
- **Spire 15-daagse forecast (Point):** de lange horizon zit op `time_bundle=6_hourly_15day` (360h), niet op alleen `medium_range_std_freq` / `6_hourly` (~7 dagen). App (`lib/spire.ts`) en ingest (`weather_engine_hourly.py`) gebruiken dezelfde merge; optioneel `SPIRE_FORECAST_PRODUCT` / `SPIRE_FORECAST_UNIT_SYSTEM`. Details: [.cursor/skills/samui-concierge/SKILL.md](.cursor/skills/samui-concierge/SKILL.md).
- 19 april 2026 — **Mijlpaal: uurlijkse weather engine in productie.** Spire (OPF + standard point), RainViewer-tile op de pin, `beach_score` met radar-straf, `radar_status` in Supabase. RPC `archive_expired_forecasts` + upsert naar `weather_forecast`. GitHub Actions (`Weather hourly ingest`) met secrets op `samuiweather`; aparte clock-repo opgeruimd. Lokaal: `weather-hourly.cmd` / `.venv` op Windows.
- 16 april 2026: Radar zoom fix doorgevoerd.