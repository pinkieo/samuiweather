-- C:\Users\andre\Samui\PASTE_VIEWS_ONLY_sammi.sql  (root = open from Explorer, not chat link)
-- file: 013_sammi_forecast_views.sql (copy in project root for easy find)
-- Sammi views: public.sammi_forecast, public.sammi_daily_forecast
-- Mist/JSON: see SUPABASE_PASTE_ME. Type change 42P16: DROPs below, or full paste file.
-- kans_*_pct_sammi: probabilities expected 0-1, times 100 for display.
-- daily grouping: valid_time_utc at Asia/Bangkok calendar day
--
-- Do not use bare lines of equal signs: Postgres parses = as operator if -- is missing.

-- 0) Rebuild: OR REPLACE cannot change a column data type (error 42P16)
DROP VIEW IF EXISTS public.sammi_daily_forecast CASCADE;
DROP VIEW IF EXISTS public.sammi_forecast CASCADE;

-- 1) sammi_forecast

CREATE OR REPLACE VIEW public.sammi_forecast AS
WITH w AS (
  SELECT
    wf.issuance_time_utc,
    wf.valid_time_utc,
    wf.valid_time_ict,
    wf.air_temperature_c,
    wf.precipitation_rate,
    wf.probability_of_precipitation_1hr,
    /* Unified OPF/Spire: column first, else JSON (engine always fills values_json) */
    COALESCE(
      wf.probability_of_thunderstorm,
      (wf.values_json->>'probability_of_thunderstorm')::double precision
    ) AS probability_of_thunderstorm,
    COALESCE(
      wf.probability_of_fog,
      (wf.values_json->>'probability_of_fog')::double precision
    ) AS probability_of_fog,
    wf.cape,
    wf.lifted_index,
    wf.wind_speed_ms,
    wf.wind_gust_ms,
    wf.wind_direction_deg,
    wf.total_cloud_cover,
    wf.beach_score,
    wf.values_json,
    wf.updated_at
  FROM public.weather_forecast wf
  WHERE wf.valid_time_utc >= (now() - interval '12 hours')
)
SELECT
  w.issuance_time_utc,
  w.valid_time_utc,
  w.valid_time_ict,

  w.air_temperature_c AS temperature_c,
  ROUND(
    (((w.air_temperature_c * 9.0 / 5.0) + 32.0))::numeric,
    1
  ) AS temperature_f,

  w.precipitation_rate,

  /* 0-1 for rain, feeds kans_regen = * 100 (double precision: stable for CREATE OR REPLACE) */
  (
    CASE
      WHEN w.probability_of_precipitation_1hr IS NULL THEN NULL::double precision
      WHEN w.probability_of_precipitation_1hr::double precision <= 1 THEN
        w.probability_of_precipitation_1hr::double precision
      ELSE (w.probability_of_precipitation_1hr::double precision / 100.0)
    END
  ) AS precip_prob_1h,

  w.probability_of_thunderstorm,
  w.probability_of_fog,
  w.cape,
  w.lifted_index,

  w.wind_speed_ms AS wind_speed,
  w.wind_gust_ms AS wind_gust,
  w.wind_direction_deg,

  w.total_cloud_cover,
  w.beach_score,
  w.values_json,

  CASE
    WHEN w.valid_time_utc
      <= COALESCE(w.issuance_time_utc, w.updated_at) + interval '48 hours' THEN
      'hourly'::text
    WHEN w.valid_time_utc
      <= COALESCE(w.issuance_time_utc, w.updated_at) + interval '120 hours' THEN
      'mixed'::text
    ELSE
      '6_hourly_trend'::text
  END AS resolution,

  w.updated_at AS last_updated,

  /* Clean % columns (0-100): must match the CASE expression for precip on one line
     so it equals COALESCE(precip_prob_1h) from the selected column above. */
  ROUND((
    COALESCE(
      (
        CASE
          WHEN w.probability_of_precipitation_1hr IS NULL THEN NULL::double precision
          WHEN w.probability_of_precipitation_1hr::double precision <= 1 THEN
            w.probability_of_precipitation_1hr::double precision
          ELSE (w.probability_of_precipitation_1hr::double precision / 100.0)
        END
      ),
      0::double precision
    ) * 100
  )::numeric, 0) AS kans_regen_pct_sammi,

  ROUND((
    COALESCE(w.probability_of_thunderstorm, 0::numeric) * 100
  )::numeric, 0) AS kans_onweer_pct_sammi,

  ROUND((
    COALESCE(w.probability_of_fog, 0::numeric) * 100
  )::numeric, 0) AS kans_mist_pct_sammi,

  CASE
    WHEN w.valid_time_utc
      <= COALESCE(w.issuance_time_utc, w.updated_at) + interval '48 hours' THEN
      'high'::text
    WHEN w.valid_time_utc
      <= COALESCE(w.issuance_time_utc, w.updated_at) + interval '120 hours' THEN
      'medium'::text
    ELSE
      'low'::text
  END AS reliability
FROM w;

COMMENT ON VIEW public.sammi_forecast IS
  'Sammi hourly: full columns + kans_regen/onweer/mist (0-100) + reliability; fog/thunder from column or values_json.';

-- 2) sammi_daily_forecast

CREATE OR REPLACE VIEW public.sammi_daily_forecast AS
WITH day_rows AS (
  SELECT
    (sf.valid_time_utc AT TIME ZONE 'Asia/Bangkok')::date AS forecast_date,
    (sf.valid_time_utc AT TIME ZONE 'Asia/Bangkok')::time AS ict_time_bkk,
    sf.temperature_c,
    sf.kans_regen_pct_sammi,
    sf.kans_onweer_pct_sammi,
    sf.kans_mist_pct_sammi,
    sf.cape,
    sf.reliability
  FROM public.sammi_forecast sf
),
agg AS (
  SELECT
    dr.forecast_date,
    ROUND(AVG(dr.temperature_c)::numeric, 1) AS avg_temp_c,
    ROUND(MAX(dr.temperature_c)::numeric, 1) AS max_temp_c,
    ROUND(MIN(dr.temperature_c)::numeric, 1) AS min_temp_c,
    ROUND(AVG(dr.kans_regen_pct_sammi)::numeric, 0) AS chance_of_rain_pct,
    ROUND(MAX(dr.kans_onweer_pct_sammi)::numeric, 0) AS chance_of_thunderstorm_pct,
    ROUND(MAX(dr.kans_mist_pct_sammi)::numeric, 0) AS chance_of_fog_pct,
    MAX(dr.cape) AS max_cape,
    /* PM (Bangkok) vs AM rain */
    ROUND(
      MAX(
        CASE
          WHEN dr.ict_time_bkk >= time '12:00' THEN
            dr.kans_regen_pct_sammi
        END
      )::numeric,
      0
    ) AS max_afternoon_rain_pct,
    ROUND(
      MAX(
        CASE
          WHEN dr.ict_time_bkk < time '12:00' THEN
            dr.kans_regen_pct_sammi
        END
      )::numeric,
      0
    ) AS max_morning_rain_pct,
    CASE
      WHEN bool_or(dr.reliability = 'low') THEN
        'low'::text
      WHEN bool_or(dr.reliability = 'medium') THEN
        'medium'::text
      ELSE
        'high'::text
    END AS reliability_level
  FROM day_rows dr
  GROUP BY dr.forecast_date
)
SELECT
  a.forecast_date,
  a.avg_temp_c,
  a.max_temp_c,
  a.min_temp_c,
  a.chance_of_rain_pct,
  a.chance_of_thunderstorm_pct,
  a.chance_of_fog_pct,
  a.reliability_level,
  CASE
    /* Far horizon + unstable air */
    WHEN a.reliability_level = 'low' AND COALESCE(a.max_cape, 0::numeric) > 2000::numeric THEN
      'Long-range only: big-picture pattern - use hourly for real timing and storms.'

    WHEN a.reliability_level = 'low' THEN
      'Long-range: treat rain/storm as a broad trend, not hours.'

    /* Strong thunder + CAPE */
    WHEN
      (COALESCE(a.chance_of_thunderstorm_pct, 0::numeric) > 35::numeric
        OR COALESCE(a.max_cape, 0::numeric) > 2000::numeric)
      AND a.reliability_level <> 'low' THEN
      'Storms in play - have a plan B, especially PM. Watch lightning + CAPE.'

    /* Rain more PM than AM (same calendar day) */
    WHEN
      COALESCE(a.max_afternoon_rain_pct, 0::numeric) > 45::numeric
      AND COALESCE(a.max_morning_rain_pct, 0::numeric) < 25::numeric
      AND COALESCE(a.chance_of_rain_pct, 0::numeric) > 30::numeric THEN
      'Wet leans to the PM - mornings can still be softer; keep the hourly strip open.'

    /* Plain wet day */
    WHEN COALESCE(a.chance_of_rain_pct, 0::numeric) > 40::numeric THEN
      'Wet day - pack a light cover; sun breaks are still possible early.'

    /* Mist */
    WHEN COALESCE(a.chance_of_fog_pct, 0::numeric) > 25::numeric THEN
      'Mist or low cloud possible - earlier hours feel softer and hazier on the vis.'

    /* Nice, trustworthy window */
    WHEN
      a.reliability_level = 'high'
      AND COALESCE(a.chance_of_rain_pct, 0::numeric) < 30::numeric
      AND COALESCE(a.chance_of_thunderstorm_pct, 0::numeric) < 20::numeric THEN
      'Clean beach day signal on this part of the run - enjoy, stay hydrated.'

    ELSE
      'Typical warm island day - SPF, water, quick glance at hourly for tweaks.'
  END AS sammi_advice
FROM agg a;

COMMENT ON VIEW public.sammi_daily_forecast IS
  'Per Bangkok day: daily temps, rain/thunder/mist, reliability_level, English advice (PM vs AM rain, CAPE, mist, horizon).';
