# Daily vacation forecast

## Purpose

The dashboard opens with a **Today in Koh Samui** Daily Vacation Brief: a
practical day plan for a visitor, built from hourly forecast rows rather than a
single daily average.

It answers when to use the beach, when rain or thunder builds, and whether the
evening still works outdoors.

## Presentation

The compact card sits at the top of the Samui vacation dashboard and shows:

1. the three most important conclusions for today;
2. morning / afternoon / evening snapshots;
3. min–max temperature, rain chance, rain intensity, wind, thunder;
4. fog / low visibility and convective ceiling only when they matter;
5. a short practical summary.

Windows are generated from the hours (examples of form, not canned copy):

- Best beach window: 09:00–12:00
- Rain risk increases after 15:00
- Thunderstorm risk highest around 17:00–19:00
- Evening looks suitable for outdoor dinner

Koh Samui is the default place. This card is Samui-only (not Krabi, not voyage).

## Data flow

```text
Spire hourly rows (+ OPF / sammi_forecast overlay)
        + optional sammi_daily_forecast day totals
        -> coverage + freshness check
        -> period snapshots + time windows
        -> three conclusions + summary
```

- **Hourly rows** decide time windows (beach, rain, heat, wind, thunder, evening).
- **`sammi_daily_forecast`** may supply day min/max, day-level rain/thunder/fog
  chance, and convective ceiling. It never invents a beach or dinner clock.
- Existing rain-chance helper `rainChancePercentForRow` is reused (Sammi % when
  present, else Spire POP). No second weather-normalisation path.

## Decision rules

Times are Asia/Bangkok.

| Period    | Hours (ICT) |
|-----------|-------------|
| Morning   | 06:00–12:00 |
| Afternoon | 12:00–18:00 |
| Evening   | 18:00–22:00 |

- **Dry hour:** rain chance &lt; 30% and precip rate &lt; 0.3 mm/h.
- **Wet hour:** rain chance ≥ 35% or precip rate ≥ 0.4 mm/h.
- **Beach window:** ≥ 2 consecutive dry, non-thundery hours between 07:00 and 18:00; the lowest-risk 2–4 hour subwindow is named. No window if that run does not exist.
- **Rain window:** longest/wettest contiguous wet run. If the morning was mostly dry and rain starts from midday: “Rain risk increases after HH:00”.
- **Thunder hour:** Sammi thunder % ≥ 20 *and* rain or CAPE support, or CAPE ≥ 1000 J/kg with rain. Isolated overnight 100% thunder without rain is stored as-is but is not a vacation thunder window. Window is the strongest contiguous run between 07:00 and 22:00.
- **Evening dining:** ≥ 2 consecutive dry evening hours and at least half of the evening usable.
- **Fog:** shown only when mist % is high in the morning, or in at least two hours. A single isolated spike is not enough.
- **Ceiling:** shown when the lowest cloud base is ≤ 800 m AGL.
- **Verdict bands:** Indoor-first (heavy rain / repeated thunder), Rain-aware (wet or ≥ 45% rain), Flexible (moderate rain/wind or no beach window), Beach-first (none of the above).

## Freshness and honesty

Uses the existing 90-minute Spire stale threshold (`ageMinutes` / provenance).

If the forecast is **stale** or **hourly coverage is too thin**:

- say so on the card;
- do **not** name a beach window or outdoor-dinner window;
- still show whatever period numbers exist, labelled as incomplete.

Missing hours are not interpolated. A period with zero hours says it has no data.

## Provenance

Source line: Spire hourly forecast with Samui Optimized Point probability overlay,
plus `sammi_daily_forecast` day totals when that view row is present.

No new ingest job, no new database table, no radar change, no OPF clamping.
