-- Daily roll-up for Sammi (app copy + YouTube script) — build on sammi_forecast
-- Run after 010 (or 011) so public.sammi_forecast exists.
--
-- Rules:
--   forecast_date = calendar day Asia/Bangkok (toerist / eiland-dag)
--   overall_reliability = conservative: laag if any hour laag, else medium if any medium, else hoog
--   kans_*_sammi: AVG/MAX respect NULL (laag-band has no hard %)

CREATE OR REPLACE VIEW public.sammi_daily_forecast AS
SELECT
  d.location_id,
  d.forecast_date,

  d.avg_temp_c,
  d.max_temp_c,
  d.min_temp_c,

  d.avg_temp_ochtend_c,
  d.avg_temp_middag_c,
  d.avg_temp_avond_c,

  d.avg_kans_regen_pct,
  d.max_kans_onweer_pct,
  d.max_kans_mist_pct,

  d.avg_kans_regen_middag_pct,

  d.overall_reliability,

  CASE
    WHEN d.max_kans_onweer_pct > 35 OR d.max_cape > 2000 THEN
      'Onweer mogelijk in de middag – plan indoor activiteiten na 15:00. '
      || 'Thunderstorms likely in the afternoon – better plan indoor activities after 3 PM.'
    WHEN COALESCE(d.avg_kans_regen_pct, 0) > 40 THEN
      'Kans op korte buien, vooral in de middag. '
      || 'Chance of short showers, mainly in the afternoon.'
    WHEN COALESCE(d.max_kans_mist_pct, 0) > 25 THEN
      'Mist mogelijk in de ochtend. Morning mist possible.'
    WHEN d.overall_reliability = 'hoog' THEN
      'Prima beach dag! Good beach day!'
    WHEN d.overall_reliability = 'laag' AND d.max_cape > 2000 THEN
      'Verder in de week onweerstrend vooral rond middaguur (indicatief). '
      || 'Mid-week thunder trend around noon (indicative only).'
    WHEN d.overall_reliability = 'laag' THEN
      'Alleen trend-weer (geen harde %). Trend-only forecast — no precise percentages.'
    ELSE
      'Normale Samui condities – geniet van de zon. Typical Samui weather – enjoy the sun.'
  END AS samui_advice_nl_en,

  d.aantal_uren,
  d.eerste_tijd_ict,
  d.laatste_tijd_ict,
  d.max_cape
FROM (
  SELECT
    h.location_id,
    (h.valid_time_utc AT TIME ZONE 'Asia/Bangkok')::date AS forecast_date,

    ROUND(AVG(h.temperature_c), 1) AS avg_temp_c,
    ROUND(MAX(h.temperature_c), 1) AS max_temp_c,
    ROUND(MIN(h.temperature_c), 1) AS min_temp_c,

    ROUND(
      AVG(h.temperature_c) FILTER (
        WHERE EXTRACT(
          HOUR FROM (h.valid_time_utc AT TIME ZONE 'Asia/Bangkok')
        ) BETWEEN 6 AND 11
      ),
      1
    ) AS avg_temp_ochtend_c,
    ROUND(
      AVG(h.temperature_c) FILTER (
        WHERE EXTRACT(
          HOUR FROM (h.valid_time_utc AT TIME ZONE 'Asia/Bangkok')
        ) BETWEEN 12 AND 17
      ),
      1
    ) AS avg_temp_middag_c,
    ROUND(
      AVG(h.temperature_c) FILTER (
        WHERE EXTRACT(
          HOUR FROM (h.valid_time_utc AT TIME ZONE 'Asia/Bangkok')
        ) BETWEEN 18 AND 23
      ),
      1
    ) AS avg_temp_avond_c,

    ROUND(AVG(h.kans_regen_pct_sammi), 0) AS avg_kans_regen_pct,
    MAX(h.kans_onweer_pct_sammi) AS max_kans_onweer_pct,
    MAX(h.kans_mist_pct_sammi) AS max_kans_mist_pct,

    ROUND(
      AVG(h.kans_regen_pct_sammi) FILTER (
        WHERE EXTRACT(
          HOUR FROM (h.valid_time_utc AT TIME ZONE 'Asia/Bangkok')
        ) BETWEEN 12 AND 17
      ),
      0
    ) AS avg_kans_regen_middag_pct,

    CASE
      WHEN bool_or(h.reliability = 'laag') THEN 'laag'
      WHEN bool_or(h.reliability = 'medium') THEN 'medium'
      ELSE 'hoog'
    END AS overall_reliability,

    COUNT(*)::integer AS aantal_uren,
    MIN((h.valid_time_utc AT TIME ZONE 'Asia/Bangkok')::time) AS eerste_tijd_ict,
    MAX((h.valid_time_utc AT TIME ZONE 'Asia/Bangkok')::time) AS laatste_tijd_ict,
    MAX(h.cape) AS max_cape
  FROM public.sammi_forecast h
  GROUP BY
    h.location_id,
    (h.valid_time_utc AT TIME ZONE 'Asia/Bangkok')::date
) d;

COMMENT ON VIEW public.sammi_daily_forecast IS
  'Per Bangkok-dag: temp + POP/onweer/mist (sammi-kolommen), reliability, NL+EN advice — app / YouTube.';
