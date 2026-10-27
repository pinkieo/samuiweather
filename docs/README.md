# Samui / Sammi documentation index

Status: CANONICAL
Document version: 2.16
Last updated: 2026-10-27
Last verified: NOT VERIFIED
Owner: ProSeadure

This is the **only** documentation index for this repository.

The user vibe-codes and does not maintain Markdown by hand. Agents
must keep this index and the listed canonical documents current.

**Only documents in the Canonical section may define current
repository behaviour.** Draft, reference, and archived files must
not be used as current requirements. Git history is the history;
do not create versioned copies of documents.

Live production facts are not proven by Markdown. Verify on the
authorised production host.

## Canonical

| Document | Subject | Version | Last updated | Last verified |
|---|---|---|---|---|
| [AGENTS.md](../AGENTS.md) | Agent operating instructions for this repo | 1.0 | 2026-09-01 | NOT VERIFIED |
| [docs/README.md](README.md) | Documentation index (this file) | 2.16 | 2026-10-27 | NOT VERIFIED |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Sammi AI / Samui weather architecture | 14.1 | 2026-10-27 | 2026-10-27 |
| [docs/daily-vacation-forecast.md](daily-vacation-forecast.md) | Daily vacation brief | 3.2 | 2026-10-18 | NOT VERIFIED |
| [docs/daily-forecast-board.md](daily-forecast-board.md) | Guest daily forecast board (`/board/today`) | 6.1 | 2026-10-27 | 2026-10-27 |
| [docs/sammi-broadcast.md](sammi-broadcast.md) | Sammi tourist weather TV (3× daily feature) | 8.3 | 2026-10-18 | NOT VERIFIED |
| [docs/weather-ingest.md](weather-ingest.md) | 4× daily Spire ingest (cron-job.org) | 3.0 | 2026-10-21 | NOT VERIFIED |
| [docs/ecowitt.md](ecowitt.md) | Ecowitt station ingest + ICT day archive | 2.3 | 2026-10-17 | 2026-09-13 |
| [docs/forecast-overview.md](forecast-overview.md) | 4× daily Spire OPF lock vs Ecowitt | 2.1 | 2026-10-17 | NOT VERIFIED |

## Draft

None.

## Reference

Supporting information. Does **not** define current behaviour.

| Document | Subject |
|---|---|
| [readme.md](../readme.md) | Project setup notes |
| [docs/research/weather-models/SAMUI_ECOWITT_SOURCE.md](research/weather-models/SAMUI_ECOWITT_SOURCE.md) | Research note |
| [docs/research/weather-models/SAMUI_FORECAST_PROVENANCE.md](research/weather-models/SAMUI_FORECAST_PROVENANCE.md) | Research note |

## Archived

None.

## Unmanaged

Not in this index and not current policy: `logs/`, test fixtures,
skill copies under `.grok/skills/` (skills must follow canonical
docs, not replace them), and any synced read-only `sources/`.
