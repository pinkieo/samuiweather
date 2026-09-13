# Sammi AI - Project skills & architecture (V2)

Status: CANONICAL
Document version: 3.2
Last updated: 2026-09-13
Last verified: NOT VERIFIED
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
- **Picture:** DWD ICON 10 m wind (`GET /api/weather/wind-overlay`). Not used for Sammi or dashboard numbers.
- Low-knot colours are saturated cyan so a tropical breeze reads on satellite water. Live radar stays above the wind raster.
- **UI:** one toggle, **Weather overlay** on/off. Default off.

### 4. Ecowitt ground truth (Baan Ton Kluay)
- Live: `GET /api/ecowitt/latest`. Day archive: `GET /api/ecowitt/daily?date=YYYY-MM-DD` (ICT). Forecast skill vs that day: `GET /api/forecast/accuracy?date=YYYY-MM-DD`.
- Numbers on the dashboard / Sammi still come from Spire. The station is verification and “now” blend, not a second forecast source.

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

- **Feature** 07:00 / 11:00 / 15:00 / 19:00 ICT, ~2:00.
- **Hourly Now** 06:00–22:00 ICT except those four hours, 15–20s.
- Presenter still: `public/broadcast/sammi/presenter.png`. Overlay cutout: `public/broadcast/sammi/cutout.png`.
- Studio: `/studio?slot=` (noindex). Script API: `/api/broadcast/script`. Render: `npm run broadcast:render`.
- Public player: `/broadcast`. Catalog: `GET /api/broadcast/latest`. On-air chip is bottom-right, not over the weather drawer.
- Do **not** cron this on Vercel Hobby. Render/assemble off-site (LENOVOX13).
- Windows task **Samui Broadcast** (`broadcast-hourly-silent.vbs`), hourly ICT; see `docs/sammi-broadcast.md`.

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
