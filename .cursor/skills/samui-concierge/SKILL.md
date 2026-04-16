---
name: samui-concierge
description: >-
  Architecture, conventions, and rules for the Samui weather dashboard and Sammi AI concierge.
  Use when working on any feature in this project — weather data, radar overlay, Sammi chat,
  vector search, Reddit embedding, or Mapbox map. Enforces the hybrid data policy:
  SPIRE for forecasts, Surat Thani radar for live rain, Supabase pgvector for Sammi's brain.
---

# Samui Concierge — Project Skill

## 🏛️ Architecture at a Glance

| Layer | Technology | Rule |
|---|---|---|
| Frontend | Next.js 15 App Router + Tailwind | No pages router |
| Map | Mapbox GL JS + react-map-gl | One `MapViewer.tsx` orchestrates everything |
| Forecasts | **SPIRE Weather API only** | Never OpenWeather, never TMD forecast |
| Live Radar | Surat Thani / TMD via RainViewer proxy | `/api/radar/[...path]` proxies tiles |
| AI Chat | OpenAI GPT-4o-mini | Max 200 tokens, Sammi persona always active |
| Vector Search | Supabase pgvector, `text-embedding-3-small` | 1536 dims, cosine similarity |
| Community | Reddit r/kohsamui + r/weathersamui | Embedded via `npm run embed` |

## 📡 Data Policy (STRICT)

**Forecasts** → always `SPIRE_API_TOKEN` via `/api/spire/forecast`.
**Live radar** → RainViewer tiles (aggregates TMD Surat Thani Doppler), proxied via `/api/radar/[...path]`.
**Never** use OpenWeather, OpenMeteo, or any other forecast source.
**Never** call RainViewer tiles directly from the browser — always go through the proxy.

## 🤖 Sammi's Persona Rules

Sammi is a witty, protective, high-end Island Concierge for Koh Samui.

- Speaks English. Occasionally calls user "darling" or "love" — sparingly.
- Max 3 sentences per response unless detail is truly needed.
- References real Koh Samui locations: Chaweng, Fisherman's Village, Bophut, Lamai, Lipa Noi, Bang Por, Mae Nam, Crystal Bay, Silver Beach.
- Weather-aware: always incorporate current conditions naturally.
- System prompt lives in `app/api/sammi/chat/route.ts` → `buildSystemPrompt()`.

## 📁 Key Files

```
components/
  SammiConcierge.tsx      ← Avatar + chat UI (forecastRows prop required)
  MapViewer.tsx           ← Mapbox + single radar Source + all overlays
  RainRadarControls.tsx   ← Radar timeline slider, auto-refresh every 5 min
  VacationDashboard.tsx   ← Verdict hero + hourly/daily forecast
app/api/
  spire/forecast/         ← SPIRE forecast (source of truth for weather)
  radar/[...path]/        ← Tile proxy for RainViewer/TMD (edge runtime)
  reddit/                 ← Live r/kohsamui feed for Sammi bubble
  sammi/chat/             ← Vector search + GPT chat endpoint
  cron/embed/             ← Auto-sync Reddit → Supabase (every 6h via Vercel)
  tides/ airquality/ uvindex/
scripts/
  embed-reddit.ts         ← Manual embed: npm run embed
supabase/
  001_island_embeddings.sql ← Table + match_island_info() RPC
```

## 🗄️ Supabase Schema

```sql
island_embeddings (
  id, source, title, content, url, author,
  score, metadata jsonb, embedding vector(1536),
  created_at, updated_at
)
-- RPC: match_island_info(query_embedding, match_count, match_threshold)
-- Project: https://tftkciljzqbiozqfdziv.supabase.co
```

## 🔑 Environment Variables

```
NEXT_PUBLIC_MAPBOX_TOKEN   ← Mapbox public token
SPIRE_API_TOKEN            ← SPIRE Weather API (server-only)
SUPABASE_URL               ← https://tftkciljzqbiozqfdziv.supabase.co
SUPABASE_SERVICE_ROLE_KEY  ← sb_secret_... (server-only, never expose)
OPENAI_API_KEY             ← sk-proj-... (server-only)
CRON_SECRET                ← Secures /api/cron/embed
NEXT_PUBLIC_AQICN_TOKEN    ← Air quality
NEXT_PUBLIC_OPENUV_API_KEY ← UV index
```

## ⚡ Common Tasks

**Add new knowledge to Sammi's brain:**
```powershell
npm run embed   # fetches r/kohsamui + r/weathersamui, upserts to Supabase
```

**Test Sammi chat locally:**
```powershell
curl -X POST http://localhost:3001/api/sammi/chat `
  -H "Content-Type: application/json" `
  -d '{"message":"Best beach today?"}'
```

**Trigger cron manually:**
```powershell
curl -X POST http://localhost:3001/api/cron/embed `
  -H "Authorization: Bearer samui-cron-2026"
```

**Run TypeScript check:**
```powershell
npx tsc --noEmit
```

## 🚫 Never Do

- Use `SammiCard.tsx` — it's been replaced by `SammiConcierge.tsx`
- Set `radarUrls[]` with multiple Sources in Mapbox — use single active Source only
- Fetch RainViewer tiles directly from browser — always proxy via `/api/radar/`
- Use OpenWeather or any non-SPIRE forecast source
- Expose `SUPABASE_SERVICE_ROLE_KEY` or `OPENAI_API_KEY` to the client

## 🔄 Radar Architecture

Single Mapbox `<Source key={activeRadarUrl}>` — URL changes per frame.
`RainRadarControls` → calls `onTimeChange(activeUrl, spireIndex)` on slider move.
Color scheme 6 (Rainbow SELEX-IS) at opacity 0.85 for tropical rain visibility.
Auto-refresh every 5 minutes via `setInterval` in `RainRadarControls`.
