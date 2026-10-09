# Daily vacation forecast

Status: CANONICAL
Document version: 3.1
Last updated: 2026-10-09
Last verified: NOT VERIFIED
Owner: ProSeadure

## Purpose

The dashboard opens with **Now**, then **Coming up**: the next three named parts
of the day that still have forecast hours. A part that has already ended is not
drawn, and an empty part is not drawn. The card does not say that a forecast
cannot be given.

Rain chance on a part is the highest 1-hour chance inside those hours. The
stored day average from `sammi_daily_forecast` is not shown on this card.

## Presentation

The top of the Samui drawer shows:

1. **Now** — garden station temperature, raining or not, and wind, when the
   reading is under 20 minutes old. If it is older, the line says the station
   reading is late and shows the current forecast hour’s temperature and wind.
   This block has no rain percentage.
2. **Coming up** — three parts, each with its clock span, temperature range,
   highest 1-hour rain chance, and strongest wind.
3. The hourly strip, using that same 1-hour chance.

Sammi’s badge repeats Now and the current forecast hour. It does not show a
third percentage.

The card ends with one daily paragraph, the same line Sammi used to write in the
morning chat:

- Now — fresh station temperature, and dry or raining on the gauge. A late or
  missing station says the reading is late and uses the current forecast hour’s
  temperature and wind. This clause has no rain percentage.
- Day — temperature range, highest 1-hour rain chance (“up to N%”), and the
  strongest wind in those hours. One wind number.
- One tourist line from the verdict: Beach-first “Normal tourist day.”,
  Flexible “Normal tourist day with a light shower backup.”, Rain-aware
  “Keep a covered plan.”, Indoor-first “Indoor-first day.”

A delayed forecast replaces the whole paragraph with “Forecast is delayed.”

Windows are generated from the hours (examples of form, not canned copy):

- Best beach window: 09:00–12:00
- Rain risk increases after 15:00
- Thunderstorm risk highest around 17:00–19:00
- Evening looks suitable for outdoor dinner

Koh Samui is the default place. This card is Samui-only (not Krabi, not voyage).

## Data flow

```text
Spire hourly rows still ahead (+ OPF / sammi_forecast overlay on the hour)
        -> the three parts for this time of day
        -> each part’s highest 1-hour chance, temperature, wind
```

- **Now** is the Baan Ton Kluay station. It is not copied onto a forecast hour.
- The private now-cast is not copied onto a forecast hour and does not change
  a rain chance.
- **Hourly rows** decide the parts and any beach or dinner line.
- **`sammi_daily_forecast` averages stay off this card.** The operator overview
  may still show a day average, and it must keep the word “average”.
- Rain chance uses `rainChancePercentForRow` (Sammi 1-hour % when present,
  otherwise Spire POP). The daily outlook uses that same highest hour, not the
  day average.

## Decision rules

Times are Asia/Bangkok.

| Local time | The three parts |
|---|---|
| 00:00–06:00 | Rest of the night · Morning · Midday |
| 06:00–12:00 | Morning · Midday · Evening |
| 12:00–18:00 | Midday · Evening · Tomorrow morning |
| 18:00–24:00 | Tonight · Tomorrow morning · Tomorrow midday |

Morning is 06:00–12:00, midday 12:00–18:00, evening 18:00–22:00. Tonight is
18:00–06:00 and includes the hours after midnight. A part shows only the hours
still ahead, with that real span. A part with no hours is omitted.

- **Dry hour:** rain chance &lt; 30% and precip rate &lt; 0.3 mm/h.
- **Wet hour:** rain chance ≥ 35% or precip rate ≥ 0.4 mm/h.
- **Beach window:** ≥ 2 consecutive dry, non-thundery hours between 07:00 and 18:00; the lowest-risk 2–4 hour subwindow is named. No window if that run does not exist.
- **Rain window:** longest/wettest contiguous wet run. If the morning was mostly dry and rain starts from midday: “Rain risk increases after HH:00”.
- **Thunder hour:** Sammi thunder % ≥ 20 *and* rain or CAPE support, or CAPE ≥ 1000 J/kg with rain. Isolated overnight 100% thunder without rain is stored as-is but is not a vacation thunder window. Window is the strongest contiguous run between 07:00 and 22:00.
- **Evening dining:** ≥ 2 consecutive dry evening hours and at least half of the evening usable.
- **Fog:** shown only when mist % is high in the morning, or in at least two hours. A single isolated spike is not enough.
- **Ceiling:** shown when the lowest cloud base is ≤ 800 m AGL.
- **Verdict bands:** Indoor-first (heavy rain / repeated thunder), Rain-aware (wet or ≥ 45% rain), Flexible (moderate rain/wind or no beach window), Beach-first (none of the above).

Sammi Broadcast uses this brief as the spine. It must not invent windows the
brief withheld. The TV clock is 07:00, 13:00, and 19:00 ICT, one minute each.
See `docs/sammi-broadcast.md`.

## Freshness and honesty

Two clocks:

- **Hour coverage** — nearest forecast hour vs now, stale after 90 minutes
  (the current hour is missing from the table).
- **Ingest age** — last `weather_forecast` write, stale after ~7 hours
  (missed a 4× daily Spire cycle). See `docs/weather-ingest.md`.

If the forecast is **stale**:

- say “Forecast is delayed.”;
- do **not** name a beach window or outdoor-dinner window;
- still show the parts that have hours.

Missing hours are not interpolated and are not labelled as an empty window.

## Provenance

Source line: Spire hourly forecast. Rain chance is the highest hour in each part.

No new ingest job, no new database table, no radar change, no OPF clamping.
