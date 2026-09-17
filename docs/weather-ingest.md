# Spire forecast ingest (4× daily)

Status: CANONICAL
Document version: 1.1
Last updated: 2026-09-17
Last verified: NOT VERIFIED
Owner: ProSeadure

Production clock for `weather_forecast` / `weather_forecast_snapshot`. Spire
issues a 6-hour cycle with **hourly timesteps** already inside it. Samui
fetches that cycle **four times per day**, not every clock hour.

Do **not** add this to `vercel.json`. Vercel Hobby cannot schedule sub-daily
crons. Same pattern as Ecowitt: [cron-job.org](https://cron-job.org) calls a
deployed route.

## Cadence (Asia/Bangkok)

| ICT | Job | URL |
|---|---|---|
| 00:05, 06:05, 12:05, 18:05 | Ingest | `GET /api/cron/weather-ingest?secret=` |
| 00:10, 06:10, 12:10, 18:10 | Overview lock | `GET /api/cron/overview-lock?secret=` |

Skip a second ingest if `weather_forecast.updated_at` is younger than 180
minutes. `?force=1` bypasses the skip.

GitHub Actions **Weather hourly ingest** is not the clock. `schedule` is
removed; `workflow_dispatch` remains for a manual emergency run.

LENOVOX13 `weather-hourly.cmd` / `npm run weather:ingest -- --force` is
manual catch-up only. Do not rely on the laptop sleeping.

## Why not hourly

Each Spire issuance already contains hourly (then 3-hourly / 6-hourly)
rows for the horizon. Re-fetching every hour mostly re-stamped
`updated_at` on the same cycle. The 90-minute badge was written as if
Spire updated hourly; for this contract **ingest age is stale after ~7
hours** (missed a cycle). Missing a **current-hour row** is still 90
minutes (hour coverage).

## Endpoint

```
GET https://www.samuiweather.com/api/cron/weather-ingest?secret=<CRON_SECRET>
```

Success: `{ "ok": true, "skipped": false, "row_count": 113, "updated_at": "…" }`
or `{ "ok": true, "skipped": true, "reason": "fresh" }`.

## cron-job.org

1. Console: [console.cron-job.org](https://console.cron-job.org) → **Create cronjob**
2. Title: `Samui weather ingest`
3. URL: as above
4. Schedule: hours `0,6,12,18`, minute `5`, timezone `Asia/Bangkok`
5. Method GET, timeout 30 s, save responses
6. Second job `Samui overview lock` at minute `10` of the same hours

Or:

```bash
npm run weather:cronjob-setup
```

Needs `CRON_SECRET` and `CRONJOB_ORG_API_KEY` in `.env.local`.

## Verify

```
curl https://www.samuiweather.com/api/weather/status
```

`freshness.stale` should be false within ~7 hours of the last ingest.
`ingest.covers_current_hour` should be true.

## Broadcast

Tourist TV is **three** films, one hour after the daytime cycles: 07:00,
13:00, 19:00 ICT. The 00:00 ingest is not a show (overnight lock / optional
night summary). No 11:00 film — that hour has no new issuance.
See `docs/sammi-broadcast.md`.
