# Spire forecast ingest (4× daily)

Status: CANONICAL
Document version: 5.0
Last updated: 2026-11-16
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

The setup script updates an existing job’s schedule. A job that already
exists is not left on its old hours. The morning board stays on the
previous run when the live cron only fires at 00:05 and 12:05 ICT,
because 06:05 and 18:05 never write a snapshot. Both the ingest job and
the overview-lock job must use hours `0,6,12,18` in `Asia/Bangkok`.

## Verify

```
curl https://www.samuiweather.com/api/weather/status
```

`freshness.stale` should be false within ~7 hours of the last ingest.
`ingest.covers_current_hour` should be true.

## UV index

`weather_forecast.uv_index` (also `weather_history` and
`weather_forecast_snapshot`) is null unless that valid hour has an
index. Spire’s subscribed point bundles have no UV field. When the
point payload does include `uv_index`, `ultraviolet_index`, `UV_index`,
or `surface_uv_index`, that number is stored. Otherwise the HTTP ingest
asks OpenUV `/forecast` once and writes the index only for the matching
UTC hour. A gap stays null. It is not filled with zero, and a
neighbouring hour is not copied across.

The manual Python ingest stores a Spire index when present and leaves
an existing `uv_index` untouched when Spire sent none. The HTTP ingest
is the writer for OpenUV hours.

Schema: `supabase/024_weather_forecast_uv_index.sql`.

## Broadcast

Tourist TV is **three** films, one hour after the daytime cycles: 07:00,
13:00, 19:00 ICT. The 00:00 ingest is not a show (overnight lock / optional
night summary). No 11:00 film — that hour has no new issuance.
See `docs/sammi-broadcast.md`.

## Radar nowcast (after a successful ingest)

The cron route does not choose a UTC hour. cron-job.org fires at 00:05,
06:05, 12:05 and 18:05 in `Asia/Bangkok` (ICT, UTC+7). The handler runs
when it is called and skips a second Spire pull when
`weather_forecast.updated_at` is younger than 180 minutes. Stored keys
are UTC instants (`valid_time_utc`, `issuance_time_utc`, `updated_at`)
plus a display label `valid_time_ict`.

Hourly rain chance is not computed in this app. Spire’s point forecast
and the optimized-point overlay supply
`probability_of_precipitation_1hr`. `flattenForDb` stores that percent
on `weather_forecast` and `weather_forecast_snapshot`. The view
`sammi_forecast.kans_regen_pct_sammi` is derived from that column.

After the rows are built, `runSamuiNowcastAfterIngest` fetches
RainViewer `weather-maps.json` and unsmoothed Universal Blue tiles
(color scheme 2, `0_0`) for Koh Samui (9.5127 N, 100.0137 E). dBZ comes
only from RainViewer’s published palette. A pixel that is not an exact
palette color is not given a reflectivity.

Rules in `lib/samui-nowcast.ts`:

- A scan older than 20 minutes is skipped. The model percents stay.
- Clear radar (fresh scan, no ≥20 dBZ echo in the 700 hPa upstream
  radius or the 30 km ring, no new cell within 50 km, no growth) may
  call the next 2 hours dry. Hours from 2 h to 6 h keep the model
  percent and a “shower can still form” flag. Hours at 6 h and beyond
  are left as the model, including afternoon island convection.
- The dry-call number is not published unless
  `NOWCAST_PUBLISH_CALIBRATED_LOWERING=1` and the Brier score beats the
  raw model for that month and wind bin, with at least 30 issuances and
  5 rain events. The flag is off. Do not set it in production until a
  replay shows that skill.
- ETA is a window from a 9-member ensemble, never one clock time.
  Tracked motion needs 3 genuine past frames spanning at least 30
  minutes. Otherwise the fallback is 700 hPa wind, then the 850–500 hPa
  vector mean. If only one of 850 or 500 hPa is present, that level is
  used and named. Ecowitt wind is not steering. It can only mark a gust
  front (gust at least 5 m/s above the sustained wind) or a 2°C
  temperature drop. A northeast monsoon surge on the steering wind
  (from 22.5–67.5° at 12 m/s or more), a new or growing cell within
  50 km, or that station signature is “developing” and has no ETA.
- If radar or the wind the rule needs is missing, the model percent is
  unchanged and the reason is stored.

Steering wind is Open-Meteo, not Spire. During ingest the route requests
`wind_speed_700hPa`, `wind_direction_700hPa`, `wind_speed_850hPa`,
`wind_direction_850hPa`, `wind_speed_500hPa`, and
`wind_direction_500hPa` at 9.56 N, 100.03 E with `wind_speed_unit=kmh`
and `timezone=GMT`. Speed is stored in km/h and direction in degrees
on `values_json.open_meteo_steering`, with `source` `open-meteo` and
`fetched_at_utc`. The nowcast converts km/h to m/s. 700 hPa is the
steering wind. The snapshot `source_composition` records the same
block. A failed response, a unit other than km/h, or an hour Open-Meteo
did not return is stored as `error: "wind missing"` with no invented
speed. The model rain percent is left as Spire.

Provenance (radar time, cells, ETA source, original vs published
percent) is written to `samui_nowcast_run` when
`supabase/025_samui_nowcast.sql` has been applied. Until then the ingest
still logs the decision and returns it on the cron JSON. The cron
response is not a substitute for that table.

Cell summaries, not image bytes, go to `samui_radar_archive`. Nothing in
this repo, Vercel cron, or the cron-job.org setup scripts deleted radar
frames at 30 days. RainViewer itself only serves about 2 hours. The new
purge keeps 180 days, long enough for one Northeast-monsoon season
(about October through February) plus margin, and it will not accept a
shorter window. Do not apply migration 025 to production from the
preview. Do not change the production cron or env to turn the publish
flag on.
