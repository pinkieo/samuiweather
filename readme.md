# Samui Weather Pro

Status: REFERENCE
Document version: 1.1
Last updated: 2026-11-16
Last verified: NOT VERIFIED
Owner: ProSeadure

Live: samuiweather.com

## UI copy
All user-visible strings in the app (map overlays, cards, buttons, tooltips, the hybrid rain timeline, etc.) are **English** only — do not ship **Dutch** in the product UI. (Sammi’s voice stays English per `SKILL.md`.)

## Things To Do
- The ingest nowcast (`lib/samui-nowcast.ts`, `docs/weather-ingest.md`) checks RainViewer cells after each Spire cycle. It does not yet draw a future radar overlay on the map. That map projection is still to do.

## Updates
- **Spire 15-day point forecast:** The long horizon uses `time_bundle=6_hourly_15day` (360h), not only `medium_range_std_freq` / `6_hourly` (~7 days). The app (`lib/spire.ts`) and ingest (`weather_engine_hourly.py`) use the same merge; optional `SPIRE_FORECAST_PRODUCT` / `SPIRE_FORECAST_UNIT_SYSTEM`. See [.cursor/skills/samui-concierge/SKILL.md](.cursor/skills/samui-concierge/SKILL.md).
- **19 Apr 2026 —** Hourly weather engine in production: Spire (OPF + standard point), RainViewer at the pin, `beach_score` with radar penalty, `radar_status` in Supabase. RPC `archive_expired_forecasts` + upsert to `weather_forecast`. GitHub Actions (`Weather hourly ingest`) with repo secrets. Local: `weather-hourly.cmd` / `.venv` on Windows.
- **16 Apr 2026:** Radar zoom fix.
- **Ecowitt station:** Cloud API ingest is live; **Vercel Hobby cannot run minute crons** — use an external scheduler for `/api/cron/ecowitt-sync`. See [docs/ecowitt.md](docs/ecowitt.md).
