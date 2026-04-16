# Sammi AI - Project Skills & Architecture (V2)

Dit document is de "Source of Truth" voor Cursor en de Sammi AI-architectuur.

## 🧠 Core Intelligence: Sammi AI
- **Persona:** Intelligente, gevatte eiland-conciërge (Sammi).
- **Technologie:** OpenAI GPT-4o + Supabase Vector Search (pgvector).

## 📡 Weer & Data Logica (HYBRIDE SYSTEEM)

Sammi maakt een strikt onderscheid tussen wat er *nu* gebeurt en wat er gaat *gebeuren*.

### 1. Real-Time Radar (Live Metingen)
- **Bron:** Doppler Radar Station Surat Thani (TMD — Thai Meteorological Department).
- **Doel:** Visualisatie van actuele neerslag op de Mapbox kaart.
- **Logica:** Dit is de "Ground Truth". Als het station in Surat Thani buien detecteert boven Samui, dan regent het nu.
- **Component:** `RadarOverlay.tsx`

### 2. Weersverwachting (Predictions & Forecasts)
- **Bron:** **SPIRE Weather API.**
- **Doel:** Alle toekomstige voorspellingen op het dashboard, chat-antwoorden over morgen/volgende week.
- **Data Punten:** Windkracht, golfhoogte (Maritime), neerslagkans en temperatuur.
- **Beleid:** Gebruik NOOIT OpenWeather voor voorspellingen. Alleen SPIRE satelliet-data.

## 🛠️ Tech Stack
| Component | Technologie |
| :--- | :--- |
| **Frontend** | Next.js 15 (App Router), Tailwind CSS |
| **Backend** | Supabase (PostgreSQL + pgvector), API Routes |
| **Vector DB** | pgvector (OpenAI `text-embedding-3-small`, 1536 dims) |
| **Weather API** | SPIRE (Forecasts) |
| **Radar Feed** | Surat Thani Radar Station / TMD (Live) |
| **Map Engine** | Mapbox GL JS |
| **Community** | Reddit API (r/kohsamui + r/weathersamui) |
| **AI** | OpenAI GPT-4o-mini (chat), text-embedding-3-small (vectors) |

## 🤖 Automatisering
- **Cron Jobs:** Dagelijkse sync van Reddit posts → Supabase embeddings.
- **Endpoint:** `POST /api/cron/embed` (beveiligd met CRON_SECRET).
- **Sync:** Reddit posts worden direct vectorized en opgeslagen voor instant chat-knowledge.

## 📁 Project Structuur
```
app/
  api/
    radar/[...path]/   ← TMD radar proxy
    reddit/            ← r/kohsamui feed voor Sammi bubble
    sammi/chat/        ← Vector search + GPT antwoorden
    spire/forecast/    ← Weersverwachting (SPIRE)
    tides/             ← Getijden
    airquality/        ← Luchtkwaliteit
    uvindex/           ← UV index
    cron/embed/        ← Dagelijkse Reddit → Supabase sync
components/
  SammiConcierge.tsx   ← Avatar + chat UI + vector search
  MapViewer.tsx        ← Mapbox kaart + radar overlay
  VacationDashboard.tsx
scripts/
  embed-reddit.ts      ← Handmatige embedding pipeline
supabase/
  001_island_embeddings.sql
```
