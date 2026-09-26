# Sammi Broadcast

Status: CANONICAL
Document version: 8.0
Last updated: 2026-09-17
Last verified: NOT VERIFIED
Owner: ProSeadure

Tourist weather TV on samuiweather.com. Sammi presents. English only.

This document is the product contract. Scripts are built in
`lib/broadcast-script.ts` from the Daily Vacation Brief
(`docs/daily-vacation-forecast.md`). Do not invent a second weather path.

## Presenter lock

Canonical still: `public/broadcast/sammi/presenter.png`
(source: operator file `image Sammi.png` — teal dress, map-studio pose).

Not the chat avatar in `public/assets/sammi-avatar.png`. Wardrobe stays the
teal dress. Every later pose or 6s loop must be derived from this still.
Studio overlays `public/broadcast/sammi/loops/present.mp4` (6s idle from the
cutout). Do not mirror her into a new person.

Voice is a **woman**: OpenAI TTS `nova` when the key works; Windows fallback
must be a **female** English voice (Zira on LENOVOX13). Never David.

Lower-thirds, dates, temperatures, and place names are **code overlays**.
Do not bake numbers into generated pixels.

## Shows

Times are Asia/Bangkok.

| Show | ICT | After ingest | Length | Job |
|---|---|---|---|---|
| Morning feature | 07:00 | 06:00 cycle | **1:00** | Island → east/Gulf → Chaweng → Lamai → Bophut |
| Midday feature | 13:00 | 12:00 cycle | **1:00** | Same beats; remaining beach; thunder clock |
| Evening feature | 19:00 | 18:00 cycle | **1:00** | Same beats; tonight + tomorrow tease |

Three **one-minute** films per day. Each show is **one hour after** a new
Spire cycle. Beats: island open, east/Gulf synoptic (Vietnam low **only**
if easterly flow plus a rain/thunder window), Choeng Mon/Chaweng, Lamai
radar clock, Bophut dinner. Pose plates: `loops/present.mp4`,
`point-east.mp4`, `point-chaweng.mp4` from the locked still.

There is **no** 11:00 show. Midnight ingest is not TV. No hourly bumper.

See `docs/weather-ingest.md` for the four ingest slots.

## Tourist questions (feature order)

1. Can I beach? Named window or honest “no window”.
2. When does rain/thunder arrive? A clock, not “scattered showers”.
3. Which strip? Choeng Mon, Chaweng, Lamai, Bophut / Fisherman’s Village — fly the map.
4. Dinner outdoors?
5. Tomorrow tease — 19:00 only.

## Data and honesty

- Forecasts: Spire only (same merge as the dashboard).
- Live rain / showers: RainViewer / TMD via the existing proxy — **on in the studio picture**.
- Wind particles + colour: Spire via Theyr RouteData, same overlay as the dashboard (`GET /api/weather/wind-overlay`). MSLP isobars / sunshine wash still ICON when that fetch works. **On for the whole feature**, not one act. Picture only — not a second number source.
- Windows: `buildDailyVacationBrief` — never interpolate missing hours.
- Stale or thin hourly coverage: `delayed: true`, **do not** name a beach or dinner window, lower-third says the show is delayed.
- High reliability ≤48h: exact % when the brief has it. Low: no hard %.

## Render and schedule

Vercel Hobby **must not** cron this (`docs/ecowitt.md`). Do not add 4× jobs to
`vercel.json`.

Render on LENOVOX13 (same family as `weather-hourly.cmd`). Assemble shots with
ffmpeg. xAI video is 6s/10s plates only — never one 2-minute generated clip.

Store MP4s in object storage (Supabase Storage or R2), not git. Keep 7 days.
Local renders land in `broadcast-out/` (gitignored).

Studio (internal, `noindex`, robots disallow):

- Page: `/studio?slot=feature_0700` (add `&autoplay=1` to run the timed acts)
- Script: `GET /api/broadcast/script?slot=`
- Presenter overlay: `public/broadcast/sammi/cutout.png` (chroma from the locked still)
- Capture: `npm run broadcast:render -- --slot 7` and `--hourly`

Needs Chrome, ffmpeg, `OPENAI_API_KEY` (TTS, English, voice **nova**; Windows
**Zira** / female SAPI fallback), and Next on :3000 (`next dev` is started if
it is down).

## LENOVOX13 schedule

Laptop timezone is ICT (`SE Asia Standard Time`). One Windows task, three daily
triggers (07/13/19), no Vercel cron.

| File | Role |
|---|---|
| `broadcast-hourly.cmd` | Manual: `broadcast-hourly.cmd` or `--dry-run` / `--force` |
| `broadcast-hourly-silent.vbs` | Task Scheduler (hidden; do not call cmd.exe from the task) |
| `scripts/broadcast-schedule.ts` | Picks slot from ICT clock, skip rules, ensure Next, render |

Task name: **Samui Broadcast**. Triggers: 07:00, 13:00, 19:00 local.
Any other hour no-ops if the task is still set more often.

Skip rules (unless `--force`):

- Not a 07/13/19 ICT hour: skip
- Same slot already published in the last 50 minutes: skip
- New **feature** would be `delayed` and a **non-delayed** feature from today already exists: skip (keep the good film; player shows delayed only when that is the truth)

If Next is not on `BROADCAST_BASE_URL` (default `http://localhost:3000`), the job starts `npm run dev` hidden and leaves it running for the next hour.

Live-tested 2026-09-12 on LENOVOX13: task **Samui Broadcast** enabled, next run on the hour, battery start allowed, 20-minute limit. Laptop sleep still skips a tick (`StartWhenAvailable` catches up when the lid opens).

## Website player

- **`/broadcast`** — 16:9 TV page. Latest **feature** loops, muted autoplay + captions; tap **Sound on**. No hourly bumper insert.
- **On air chip** — bottom-right of the map (`z-40`), not over the left weather drawer. Opens `/broadcast`.
- **Drawer** — “Sammi on air” above the webcam block.

`GET /api/broadcast/latest` reads `public/broadcast/latest/manifest.json` (written by `broadcast:render`). No client Spire.

Honesty on air:

- Missing today’s feature, or a feature recorded `delayed: true` → **Show delayed** badge. The last file may still play; it is not labelled as live now.
- Empty catalog → delayed empty state + live map link.

MP4/VTT stay out of git (`public/broadcast/latest/*.mp4`). Publish on LENOVOX13 after each render. Object storage for production is a later cut.

## Out of scope here

YouTube/TikTok, Dutch voice, Krabi, Vercel as renderer.
