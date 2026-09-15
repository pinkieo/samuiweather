# 4× daily Spire OPF overview

Status: CANONICAL
Document version: 1.1
Last updated: 2026-09-15
Last verified: NOT VERIFIED
Owner: ProSeadure

Locked weather overview for Koh Samui: four ICT issuances per day, compared to the Baan Ton Kluay Ecowitt station.

## Cadence (Asia/Bangkok)

| Slot | Label | Window scored |
|---|---|---|
| 00:00 | Night / overnight | 00:00–06:00 |
| 06:00 | Morning lock | 06:00–12:00 |
| 12:00 | Midday update | 12:00–18:00 |
| 18:00 | Evening update | 18:00–00:00 |

Each slot **locks** one Spire issuance (Standard Point + OPF probability overlay) already stored in `weather_forecast_snapshot`. It does not replace that table.

## Reads / locks

- Dashboard card **Today's 4 checks** (weather drawer) and page `GET /overview`
- `GET /api/forecast/overview` — today's four slots + accuracy vs prior locks (`?date=YYYY-MM-DD`)
- `POST /api/forecast/overview` — lock current+previous, or `?date=&slot=0600` for one slot
- `GET|POST /api/cron/overview-lock?secret=` — same lock, cron-job.org / LENOVOX13

Do **not** add this to Vercel Hobby crons (sub-daily). Hourly LENOVOX13 ingest (`weather-hourly.cmd`) runs `npm run forecast:overview-lock` after `weather_engine_hourly.py`. Same pattern as Ecowitt: cron-job.org if you want 00/06/12/18 without the laptop.

## Scoring

- Window = slot start → next slot (6 h ICT).
- Temp: station mean vs issuance mean (Standard Point).
- Rain: station `rain_day` counter delta + max rate vs **uncalibrated** sum of Spire hourly rain rate and OPF chance of rain. No wet/dry yes-no.
- Thunder / fog: OPF only; station does not observe thunder.

## Store

- Hourly provenance: `weather_forecast_snapshot` (migration `021`)
- Slot lock: **`daily_forecast_slot_lock`** (migration `023`) — unique `(location_id, slot_date_ict, slot)`. First lock freezes `forecast_json` (temps/wind + OPF POP/thunder/fog). A second lock of the same slot does not duplicate; it may only write `verification_json`.
- Pointer table `weather_overview_lock` (`022`) is superseded; `023` copies it if present.

## Product rules

- Spire is the branded forecast. OPF supplies chance of rain / thunder / fog (~72 h). Temps and wind stay Standard Point.
- Ecowitt is ground truth. Never overwrite observations with the model.
- Accuracy logs **raw** numbers: temp error, station rain-counter delta, station `rainRateMaxMmh`, forecast hourly-rate sum, mean/max chance of rain. **No invented wet/dry yes-no.**
- Thunder is forecast-only; the backyard station does not observe it.
- Known skill (show, do not hide): temperature is usually close; rain is over-called on dry days and millimetres are often about double the station.

If `023` is not applied yet, the overview still reads `weather_forecast_snapshot` and may skip persisting the lock row.
