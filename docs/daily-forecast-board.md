# Daily forecast board

Status: CANONICAL
Document version: 5.0
Last updated: 2026-10-21
Last verified: NOT VERIFIED
Owner: ProSeadure

Guest still for Koh Samui, drawn server-side at `/board/today`.
A 06:00 ICT capture of this page replaces a live-radar screenshot.
Sammi is composited on the empty left side afterwards. This page does
not draw her.

English only. No map SDK, no analytics, and no radar request on this
route. The site has no cookie banner because it does not load trackers
before consent; this page adds none.

## What the board shows

Asia/Bangkok, one calendar day:

| Block | Hours |
|---|---|
| Morning | 06:00–10:00 |
| Midday | 10:00–14:00 |
| Afternoon | 14:00–18:00 |
| Evening | 18:00–22:00 |

Each block has a sun, cloud, shower, or thunder icon, a temperature,
and a chance of rain in words. The island outline is split into four
shores (north, east, south, west). Each shore is shaded from that
coast’s own forecast rain rate for the block. A gold dot marks the
Baan Ton Kluay garden station. The hourly strip is 06:00–21:00: rain
chance, thunder risk, UV, and wind. One “Best for today” line names a
beach, waterfall, market, or covered plan from those blocks.

The frame is exactly 1280×720. The left 300px is empty for a standing
presenter cutout. Tap or click the board to fill the display. The same
1280×720 frame is scaled, with the presenter gutter still on the left.
Tap or click again, or press Escape, to leave full screen. A short line
in the gutter says which of those applies.

## Data

Today’s hours come from the same live Spire merge as `GET /api/weather`:
point tiers, the optimized-point rain chance, and the OpenUV hourly
index. The issued line is the newest Spire `issuance_time` on that
merge. The hourly run is included even when the 15-day bundle already
spans the horizon: that bundle can still be an older cycle. Stored
rows in `weather_forecast` (and `weather_history` when the hour has
rolled off the rolling table) still fill any hour the live feed has
already dropped, and they are the whole board when the live read fails
or when `?date=` is not today. Location id: `samui_opf_hybrid`.

An open display asks the server for a new render every 5 minutes, and
again when the tab becomes visible. A TV left on the page does not keep
the frame it first painted.

`/api/forecast/hybrid` is not a route. Nothing in this app calls it.
A 404 from that path is expected. Do not add the endpoint.

History, temperature bias, the block wording, and the hourly strip stay
on that one stored point (`samui_opf_hybrid`). It is not replaced with
a multi-point history series, and its chance is not pasted onto every
shore.

The stored table has no spatial rain field. `values_json` is a point
record. Spire’s optimized point (the source of the stored chance) is
one custom site and is not copied onto other coordinates.

Shore colour is a separate read at page render: four light
`/forecast/point` calls, bundle `basic`, hourly, only
`precipitation_rate`. Anchors: Mae Nam (north), Chaweng (east), Lamai
(south), Lipa Noi (west). Those rows are not written to
`weather_forecast` or `weather_history`. The basic point product does
not include a chance field, so the map does not invent one from the
rate. The rate is not printed. Colour uses the strongest hour in the
block:

- missing rate → grey (unavailable)
- 0 to under 0.2 mm/h → dry (a stored 0 is real)
- 0.2 to under 1 → possible
- 1 to under 2.5 → likely
- 2.5 and above → heavy

Spire’s grid is coarser than the island. Two anchors can return the
same series; the map shows that agreement instead of inventing a
difference. If the token is missing, the day has ended, or a shore
returns no rate, that shore stays grey. The caption says the stored
forecast was not copied across the island.

Live radar is not read. Theyr wind and Open-Meteo are not read. Rain
amounts are not shown as numbers; Spire over-calls totals, so the words
on the card stay “mostly dry”, “a shower is possible”, “showers
likely”, or “rain likely”, plus the percent when the stored chance
exists.

A missing field stays blank (`—` or “unavailable”). It is not drawn as
zero. A stored 0% chance is real and reads as mostly dry.

Thunder on the strip is CAPE:

- missing CAPE → unavailable
- CAPE ≥ 1000 J/kg and rain chance ≥ 20% → higher
- CAPE ≥ 800 and rain chance ≥ 15%, or CAPE ≥ 1000 with no rain field,
  or CAPE ≥ 500 and rain chance ≥ 40% → possible
- otherwise low

UV on the hourly strip is the OpenUV index from that same live merge
(the number `GET /api/weather` returns for the hour). Spire’s subscribed
point bundles do not include a UV index. A live hour OpenUV does not
cover stays null and is then filled from Open-Meteo, the same way a
stored hour with a null `uv_index` is filled. A line under the strip
names the source(s), e.g. "UV index: OpenUV + Open-Meteo forecast." An
hour no source covers stays `—`. A 0 from a source is real and reads as
low. The strip rounds the index to a whole number; 11.6 reads as 12.

The header shows that newest Spire issuance in ICT. When the run was
issued on an earlier ICT day it carries the date, e.g.
"Issued Wed 21 Oct, 19:00 ICT", so an older cycle is not read as this
morning's. A stored row supplies the line only when the live read
fails, or when its issuance is newer than the live run.

## Temperature bias

The dashboard and Sammi brief still show the issued Spire temperature.
This board is the exception.

For each ICT hour, bias is the mean of (forecast − garden station) over
the previous 10 ICT days, using `weather_history` / `weather_forecast`
paired with `ecowitt_observations` at Baan Ton Kluay (hourly mean).
The shown temperature is forecast minus that bias.

Rules:

- At least 4 kept pairs for that hour. Fewer → show the issued temperature.
- Drop a pair when the absolute error is above 8°C.
- Do not apply a fixed 2–3°C. If recent afternoons were warmer at the
  station than in the forecast, the correction comes out positive on
  its own.
- The live station reading is not copied onto a forecast hour.
- The word “adjusted” appears when the shift is at least 0.4°C.

If the garden table cannot be read, the board still shows the issued
forecast and says the garden readings could not be read. That is
different from a successful read that simply has fewer than four kept
pairs, which says there are not enough recent garden hours.

## Sample and empty

`?sample=1` draws a labelled sample through the same shaping code, for
layout and screenshots when Supabase is not configured. The banner says
the numbers are not live. The sample shores use different illustrative
rates so the layout can show regional shading. Those rates are not a
live forecast.

Without credentials, a failed read, or an empty day, the board stays
in the unavailable state. It does not substitute the sample.

`?date=YYYY-MM-DD` selects an ICT day. The default is today in
Asia/Bangkok.

## Run locally

```bash
npm run test:unit
npx tsx scripts/verify-board-feed.ts
npm run dev
```

`verify-board-feed.ts` reads production `/api/weather` and this
project’s Supabase, then checks the board’s rain and UV for every
shared hour. It needs `SUPABASE_URL` and `SUPABASE_KEY` (or the service
role) when the stored fallback is part of the check. The live rain and
UV comparison uses the public weather route either way.

Open `http://127.0.0.1:3000/board/today` for stored data, or
`http://127.0.0.1:3000/board/today?sample=1` for the labelled sample.

Screenshot at 1280×720 (Chrome):

```bash
BOARD_URL=http://127.0.0.1:3000/board/today?sample=1 npm run board:screenshot
```

The 06:00 ICT brief screenshots the production page:

`https://www.samuiweather.com/board/today`

Do not add this capture to `vercel.json`. Vercel Hobby cannot run the
06:00 job. The external routine screenshots that URL at 1280×720.
