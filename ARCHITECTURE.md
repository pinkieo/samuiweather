# Sammi AI - Project skills & architecture (V2)

Status: CANONICAL
Document version: 8.1
Last updated: 2026-09-27
Last verified: 2026-09-17 (production `/api/weather/wind-overlay` Spire 195/195, valid 12:00Z)
Owner: ProSeadure

This document is the source of truth for Cursor and the Sammi AI architecture.

## Core intelligence: Sammi AI
- **Persona:** Smart, witty island concierge (Sammi).
- **Technology:** OpenAI GPT-4o + Supabase vector search (pgvector).

## Weather & data logic (hybrid system)

Sammi keeps a clear split between what is happening *now* and what will *happen*.

### 1. Real-time radar (live measurements)
- **Source:** Doppler radar station Surat Thani (TMD — Thai Meteorological Department).
- **Goal:** Show current rain on the Mapbox map.
- **Logic:** This is the “ground truth” signal. If the station sees rain over Samui, it is raining there now.
- **Component:** `RadarOverlay.tsx` (legacy name; see `SamuiExploreMap` / RainViewer in the app).

### 2. Weather forecast (predictions)
- **Source:** **Spire Weather API.**
- **Goal:** All future conditions on the dashboard, chat answers about tomorrow / next week.
- **Data:** Wind, maritime, rain chance, temperature.
- **Policy:** Do **not** use OpenWeather for forecasts. Spire (satellite) only.

### 3. Windy-look weather overlay (picture only)
- Copied from VIP operational-intelligence: georeferenced MapLibre wind raster + particle canvas inside the map canvas container. Not a windy.com iframe.
- **Wind picture:** Spire 10 m via Theyr RouteData (`GET /api/weather/wind-overlay`). Same path as VIP: dataFeed `bd131aaa-…` (RDAS Spire), not Spire `/forecast/point` on a grid. Theyr is delivery; Spire is the model. Requires `THEYR_LICENSE_KEY`.
- **Isobars / sunshine wash:** DWD ICON via Open-Meteo on the same box, optional. If ICON fails, wind still shows. Not used for Sammi or dashboard numbers.
- Low-knot colours are saturated cyan so a tropical breeze reads on satellite water. Live radar (showers) stays above the wind raster. Sun disc follows SunCalc altitude/azimuth.
- Particles are a slow drift, not a real-time crossing. At the island zoom (11), a 6 m/s breeze moves about 14 px/s, with a soft trail of a couple of seconds. Faster wind is visibly faster, and the speed is capped so a close zoom does not become a racetrack.
- **UI:** one toggle, **Weather overlay** on/off. **Default on** on the dashboard and in Sammi Broadcast studio (wind, isobars, showers, sun). Picture only.

### 4. Ecowitt ground truth (Baan Ton Kluay)
- Live: `GET /api/ecowitt/latest`. Day archive: `GET /api/ecowitt/daily?date=YYYY-MM-DD` (ICT). Forecast skill vs that day: `GET /api/forecast/accuracy?date=YYYY-MM-DD`. Trend: `GET /api/forecast/accuracy/trend`.
- **4× daily OPF overview:** dashboard **Today's 4 checks**, `GET /overview`, `GET|POST /api/forecast/overview`. Table `daily_forecast_slot_lock`. Contract: `docs/forecast-overview.md`.
- Forecast hours on the dashboard and in Sammi stay Spire (Samui 1-hour chance when that hour has one). The station is the Now block only: temperature, rain falling or not, and wind. It is not blended into a forecast hour. The private now-cast is not blended into a forecast hour.

## Tech stack
| Component | Technology |
| :--- | :--- |
| **Frontend** | Next.js 15 (App Router), Tailwind CSS |
| **Backend** | Supabase (PostgreSQL + pgvector), API routes |
| **Vector DB** | pgvector (OpenAI `text-embedding-3-small`, 1536 dims) |
| **Weather API** | Spire (forecasts) |
| **Radar feed** | Surat Thani / TMD via RainViewer (live) |
| **Map engine** | MapLibre / Mapbox GL |
| **Community** | Reddit API (r/kohsamui + r/weathersamui) |
| **AI** | OpenAI (chat) + `text-embedding-3-small` (vectors) |

## Sammi Broadcast (tourist TV)

Contract: `docs/sammi-broadcast.md`. Scripts: `lib/broadcast-script.ts` (Daily Vacation Brief spine).

- **Feature** 07:00 / 13:00 / 19:00 ICT, ~2:00 (one hour after 06/12/18 ingest). No 11:00 film. No midnight TV. No hourly bumper.
- Presenter still: `public/broadcast/sammi/presenter.png`. Overlay cutout: `public/broadcast/sammi/cutout.png`.
- Studio: `/studio?slot=` (noindex). Script API: `/api/broadcast/script`. Render: `npm run broadcast:render`.
- Public player: `/broadcast`. Catalog: `GET /api/broadcast/latest`. On-air chip is bottom-right, not over the weather drawer.
- Do **not** cron this on Vercel Hobby. Render/assemble off-site (LENOVOX13).
- Windows task **Samui Broadcast** (`broadcast-hourly-silent.vbs`), 07/13/19 ICT; see `docs/sammi-broadcast.md`.
- **Forecast ingest** is 4× daily via cron-job.org (`docs/weather-ingest.md`). Not GitHub Actions, not Vercel Hobby cron.

## Automation
- **Cron jobs:** Daily Reddit post sync → Supabase embeddings.
- **Endpoint:** `POST /api/cron/embed` (secured with `CRON_SECRET`).
- **Sync:** Posts are vectorized and stored for instant chat context.
- **Broadcast schedule** is not a Vercel cron. See `docs/sammi-broadcast.md`.

## Project layout
```
app/
  api/
    radar/[...path]/   ← TMD / RainViewer radar proxy
    reddit/            ← r/kohsamui feed for Sammi bubble
    sammi/chat/        ← Vector search + GPT answers
    spire/forecast/    ← Spire weather
    tides/             ← Tides
    airquality/        ← Air quality
    uvindex/           ← UV index
    ecowitt/latest     ← station now
    ecowitt/daily      ← ICT day archive from ecowitt_observations
    forecast/accuracy  ← Spire vs station for one ICT day
    forecast/accuracy/trend ← ICT-day skill series
    forecast/overview      ← 4× ICT slot lock + Ecowitt raw score
  overview/            ← 4× daily Spire vs station page
    cron/embed/        ← Daily Reddit → Supabase
    broadcast/script/  ← TV rundown JSON
    broadcast/latest/  ← on-air catalog
  broadcast/           ← public 16:9 player
  studio/              ← internal capture (noindex)
components/
  SammiConcierge.tsx
  MapViewer.tsx
  VacationDashboard.tsx
scripts/
  embed-reddit.ts
  broadcast-script.ts
lib/
  broadcast-script.ts
  broadcast-catalog.ts
public/broadcast/sammi/
  presenter.png
  cutout.png
public/broadcast/latest/
  manifest.json
supabase/
  001_island_embeddings.sql
```
