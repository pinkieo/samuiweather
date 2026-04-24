# Samui Weather Pro
Live: samuiweather.com

## Updates
- **Spire 15-day point forecast:** The long horizon uses `time_bundle=6_hourly_15day` (360h), not only `medium_range_std_freq` / `6_hourly` (~7 days). The app (`lib/spire.ts`) and ingest (`weather_engine_hourly.py`) use the same merge; optional `SPIRE_FORECAST_PRODUCT` / `SPIRE_FORECAST_UNIT_SYSTEM`. See [.cursor/skills/samui-concierge/SKILL.md](.cursor/skills/samui-concierge/SKILL.md).
- **19 Apr 2026 —** Hourly weather engine in production: Spire (OPF + standard point), RainViewer at the pin, `beach_score` with radar penalty, `radar_status` in Supabase. RPC `archive_expired_forecasts` + upsert to `weather_forecast`. GitHub Actions (`Weather hourly ingest`) with repo secrets. Local: `weather-hourly.cmd` / `.venv` on Windows.
- **16 Apr 2026:** Radar zoom fix.
