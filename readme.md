# Samui Weather Pro
Live op: samuiweather.com

## Updates
- 19 april 2026 — **Mijlpaal: uurlijkse weather engine in productie.** Spire (OPF + standard point), RainViewer-tile op de pin, `beach_score` met radar-straf, `radar_status` in Supabase. RPC `archive_expired_forecasts` + upsert naar `weather_forecast`. GitHub Actions (`Weather hourly ingest`) met secrets op `samuiweather`; aparte clock-repo opgeruimd. Lokaal: `weather-hourly.cmd` / `.venv` op Windows.
- 16 april 2026: Radar zoom fix doorgevoerd.