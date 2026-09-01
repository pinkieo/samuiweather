# Ecowitt station — Baan Ton Kluay

Status: CANONICAL
Document version: 1.0
Last updated: 2026-09-01
Last verified: NOT VERIFIED
Owner: ProSeadure

Live ground-truth from the GW3000C at Ko Samui. Two ingest paths exist; only one works reliably today.

## Vercel Hobby — cron does **not** work for minute sync

**Samui runs on a Vercel Hobby account.** That plan does **not** support sub-daily cron jobs (no every-minute or every-hour schedules).

Implications:

- Do **not** add `* * * * *` or other sub-daily entries for Ecowitt in `vercel.json` — deploy will fail or the job will not run as intended.
- The route `/api/cron/ecowitt-sync` **exists** and works when called manually, but **Vercel will not invoke it every minute** on Hobby.
- `vercel.json` only keeps daily crons that Hobby allows (e.g. `/api/cron/embed` at `0 0 * * *`).

### cron-job.org — every minute (production setup)

Vercel Hobby cannot schedule this; use [cron-job.org](https://cron-job.org) instead.

**What it does:** every minute, cron-job.org calls Samui → Samui polls Ecowitt Cloud → row in Supabase `ecowitt_observations`.

**Endpoint (already deployed):**

```
GET https://www.samuiweather.com/api/cron/ecowitt-sync?secret=<CRON_SECRET>
```

Success response: `{"ok":true,"observedAt":"…","id":"…"}`

#### Option A — Console UI (no script)

1. Sign up / log in at [console.cron-job.org](https://console.cron-job.org)
2. **Create cronjob** → **Advanced**
3. **Title:** `Samui Ecowitt → Supabase`
4. **URL:** `https://www.samuiweather.com/api/cron/ecowitt-sync?secret=<CRON_SECRET>`
5. **Schedule:** every minute — minutes `*`, hours `*`, every day/month/weekday
6. **Timezone:** `Asia/Bangkok`
7. **Request method:** GET
8. **Timeout:** 30 s
9. Enable **Save responses** (helps debug)
10. **Create** / enable the job

#### Option B — API script (repeatable)

1. [console.cron-job.org](https://console.cron-job.org) → **Settings** → copy **API key**
2. Add to `.env.local`: `CRONJOB_ORG_API_KEY=…` (and `CRON_SECRET` if not set)
3. Run:

```bash
npm run ecowitt:cronjob-setup
```

Creates the same minutely job via [cron-job.org REST API](https://docs.cron-job.org/rest-api.html).

#### Verify

- cron-job.org job history should show **HTTP 200** and body `ok: true`
- `curl https://www.samuiweather.com/api/ecowitt/latest` — fresh `stationType: ecowitt-cloud`

Local one-shot (dev / manual catch-up):

```bash
npm run ecowitt:sync
```

### Historical backfill (Ecowitt.net export)

1. Export from [ecowitt.net](https://www.ecowitt.net) → dashboard → **Export** (xlsx, e.g. `all_KoSamuiThailand(202605010000-202605312359).xlsx`)
2. Copy file to `data/ecowitt/` (gitignored)
3. Dry-run:

```bash
python scripts/import-ecowitt-xlsx.py "data/ecowitt/all_KoSamuiThailand(202605010000-202605312359).xlsx" --dry-run
```

4. Import to Supabase:

```bash
npm run ecowitt:import-xlsx -- "data/ecowitt/all_KoSamuiThailand(202605010000-202605312359).xlsx"
```

Rows upsert into `ecowitt_observations` with `station_type = ecowitt-xlsx-import`. Timestamps are interpreted as **Asia/Bangkok** then stored UTC.

### Spire vs Ecowitt verification (bias / ML)

After xlsx import, pair archived Spire (`weather_history`) with station truth:

```bash
# once: migration 20260617060000_forecast_verification.sql (or npm run db:sammi)
npm run forecast:verify-backfill
```

Writes **`forecast_verification`** with `spire_snapshot`, `observation`, `errors_json` (temp/humidity/wind/rain).

Re-run anytime after new history or Ecowitt data.

---

## Data paths

### 1. Ecowitt Cloud API (recommended — works today)

Gateway uploads to Ecowitt.net over HTTPS. Samui polls `api.ecowitt.net` and writes to Supabase.

| Env var | Purpose |
|---------|---------|
| `ECOWITT_APPLICATION_KEY` | From [ecowitt.net](https://www.ecowitt.net) → Private Center |
| `ECOWITT_API_KEY` | Same |
| `ECOWITT_MAC` | Device MAC, e.g. `5C:01:3B:43:38:A7` |

Code: `lib/ecowitt-cloud.ts` → `app/api/cron/ecowitt-sync/route.ts` → `ecowitt_observations` table.

### 2. Custom server push (GW3000C → Samui)

GW app only offers **HTTP** on port 80. Vercel responds with **308 redirect to HTTPS**; many Ecowitt gateways do not follow that redirect, so pushes often never arrive.

If it ever works (firmware with HTTPS, or redirect support):

| Field | Value |
|-------|--------|
| Protocol | `http://` |
| Host | `www.samuiweather.com` |
| Path | `api/ecowitt/ingest?secret=<ECOWITT_INGEST_SECRET>` |
| Port | `80` |
| Interval | `60` s |

| Env var | Purpose |
|---------|---------|
| `ECOWITT_INGEST_SECRET` | Must match `?secret=` on the gateway URL |

Code: `app/api/ecowitt/ingest/route.ts`

---

## Read path (dashboard)

- `GET /api/ecowitt/latest` — latest row for `baan_ton_kluay`
- UI: `components/EcowittPlaceholder.tsx`, blended into row 0 in `components/MapViewer.tsx`

Rows are ordered by `observed_at` (then `created_at`). Stale test rows with fake future timestamps can block live data — delete them in Supabase if `/latest` looks wrong.

### Forecast provenance for Ecowitt validation

Before `supabase/021_weather_forecast_snapshots.sql`, Samui retained only the
latest forecast issuance for each `valid_time_utc` in `weather_forecast`.
Existing `weather_history` records are preserved, but they do not contain a
complete historical issuance ladder.

After the migration is activated, the hourly Spire ingest also writes
`weather_forecast_snapshot`. This is an append-only provenance layer for the
same response already fetched by `weather_engine_hourly.py`; it adds no Spire
API calls and does not replace `weather_forecast`.

The snapshot stores UTC issuance/valid/retrieval times, deterministic lead
hours, normalized fields, full `values_json`, and explicit source composition:
Standard Point plus an Optimized Point probability overlay when present. It is
not a pure OPF record. See
`docs/research/weather-models/SAMUI_FORECAST_PROVENANCE.md`.

Migration 021 was activated on 2026-08-07 after capacity confirmation
(8 GB provisioned disk; approximately 1.03 GB total usage and 0.15 GB database
usage before activation). The first controlled hourly cycle stored 113
snapshots. No retention or archive policy is active yet. Storage is checked
around 2026-09-07 and 2026-11-07; review starts at 60% disk usage and action
planning is required at 75%.

---

## Keys and docs

- API keys: [www.ecowitt.net](https://www.ecowitt.net) → account icon → Private Center
- API reference: [Ecowitt API V3 docs](https://doc.ecowitt.net/web/#/apiv3en?page_id=1)
- Never commit keys or paste passwords in chat
