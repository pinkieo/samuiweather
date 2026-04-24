# Sammi AI - Project skills & architecture (V2)

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

## Automation
- **Cron jobs:** Daily Reddit post sync → Supabase embeddings.
- **Endpoint:** `POST /api/cron/embed` (secured with `CRON_SECRET`).
- **Sync:** Posts are vectorized and stored for instant chat context.

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
    cron/embed/        ← Daily Reddit → Supabase
components/
  SammiConcierge.tsx
  MapViewer.tsx
  VacationDashboard.tsx
scripts/
  embed-reddit.ts
supabase/
  001_island_embeddings.sql
```
