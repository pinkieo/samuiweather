-- Sammi: public.sammi_forecast (hourly) + public.sammi_daily_forecast (per Bangkok day)
-- Run in Supabase after weather_forecast + 014/008 columns exist.
-- Replaces 012 (superseded). PostgREST: refresh schema if columns change.
--
-- Reliability (vs issuance/updated, Spire-style): high <=48h, medium <=120h, low >120h
-- kans_*_pct_sammi: 0-100, NULL in low band (no "hard" % for Sammi per product policy)
--
-- 42P16: DROP before CREATE; types cannot change in OR REPLACE

DROP VIEW IF EXISTS public.sammi_daily_forecast CASCADE;
DROP VIEW IF EXISTS public.sammi_forecast CASCADE;

-- 1) Hourly: all engine columns + Sammi columns
CREATE OR REPLACE VIEW public.sammi_forecast AS
WITH base AS (
  SELECT
    wf.id,
    wf.location_id,
    wf.issuance_time_utc,
    wf.valid_time_utc,
    wf.valid_time_ict,
    wf.air_temperature_c,
    wf.wind_speed_ms,
    wf.wind_direction_deg,
    wf.wind_gust_ms,
    wf.total_cloud_cover,
    wf.low_cloud_cover,
    wf.mid_cloud_cover,
    wf.high_cloud_cover,
    wf.ceiling_m,
    wf.cape,
    wf.lifted_index,
    wf.probability_of_precipitation_1hr,
    wf.probability_of_precipitation_24hr,
    COALESCE(
      wf.probability_of_thunderstorm,
      (NULLIF(btrim(wf.values_json->>'probability_of_thunderstorm'), ''))::double precision
    ) AS probability_of_thunderstorm,
    COALESCE(
      wf.probability_of_fog,
      (NULLIF(btrim(wf.values_json->>'probability_of_fog'), ''))::double precision
    ) AS probability_of_fog,
    wf.precipitation_rate,
    wf.relative_humidity,
    wf.values_json,
    wf.beach_score,
    wf.radar_status,
    wf.updated_at
  FROM public.weather_forecast wf
  WHERE wf.valid_time_utc < (now() + interval '20 days')
),
n AS (
  SELECT
    b.*,
    /* 0-100, accepts Spire 0-1 or 0-100 */
    CASE
      WHEN b.probability_of_precipitation_1hr IS NULL THEN NULL::double precision
      WHEN b.probability_of_precipitation_1hr::double precision < 0 THEN 0::double precision
      WHEN b.probability_of_precipitation_1hr::double precision <= 1.0
        THEN LEAST(100::double precision, b.probability_of_precipitation_1hr * 100.0)
      ELSE LEAST(100::double precision, b.probability_of_precipitation_1hr::double precision)
    END AS rain_pct_0_100,
    CASE
      WHEN b.probability_of_thunderstorm IS NULL THEN NULL::double precision
      WHEN b.probability_of_thunderstorm::double precision < 0 THEN 0::double precision
      WHEN b.probability_of_thunderstorm::double precision <= 1.0
        THEN LEAST(100::double precision, b.probability_of_thunderstorm * 100.0)
      ELSE LEAST(100::double precision, b.probability_of_thunderstorm::double precision)
    END AS thunder_pct_0_100,
    CASE
      WHEN b.probability_of_fog IS NULL THEN NULL::double precision
      WHEN b.probability_of_fog::double precision < 0 THEN 0::double precision
      WHEN b.probability_of_fog::double precision <= 1.0
        THEN LEAST(100::double precision, b.probability_of_fog * 100.0)
      ELSE LEAST(100::double precision, b.probability_of_fog::double precision)
    END AS fog_pct_0_100,
    CASE
      WHEN b.valid_time_utc <= COALESCE(b.issuance_time_utc, b.updated_at) + interval '48 hours' THEN
        'high'::text
      WHEN b.valid_time_utc <= COALESCE(b.issuance_time_utc, b.updated_at) + interval '120 hours' THEN
        'medium'::text
      ELSE
        'low'::text
    END AS reliability
  FROM base b
)
SELECT
  n.id,
  n.location_id,
  n.issuance_time_utc,
  n.valid_time_utc,
  n.valid_time_ict,

  n.air_temperature_c AS temperature_c,
  ROUND(
    ((n.air_temperature_c * 9.0 / 5.0) + 32.0)::numeric,
    1
  ) AS temperature_f,

  n.precipitation_rate,
  /* 0-1 (chart / math), consistent with kans / 100 */
  (CASE
    WHEN n.probability_of_precipitation_1hr IS NULL THEN NULL::double precision
    WHEN n.probability_of_precipitation_1hr::double precision <= 1.0
      THEN n.probability_of_precipitation_1hr::double precision
    ELSE n.probability_of_precipitation_1hr::double precision / 100.0
  END) AS precip_prob_1h,

  n.probability_of_precipitation_24hr,
  n.probability_of_thunderstorm,
  n.probability_of_fog,

  n.cape,
  n.lifted_index,
  n.wind_speed_ms AS wind_speed,
  n.wind_gust_ms AS wind_gust,
  n.wind_direction_deg,
  n.total_cloud_cover,
  n.low_cloud_cover,
  n.mid_cloud_cover,
  n.high_cloud_cover,
  n.ceiling_m,
  n.relative_humidity,
  n.beach_score,
  n.radar_status,
  n.values_json,
  n.updated_at AS last_updated,

  CASE
    WHEN n.valid_time_utc <= COALESCE(n.issuance_time_utc, n.updated_at) + interval '48 hours' THEN
      'hourly'::text
    WHEN n.valid_time_utc <= COALESCE(n.issuance_time_utc, n.updated_at) + interval '120 hours' THEN
      'mixed'::text
    ELSE
      '6_hourly_trend'::text
  END AS resolution,

  /* Sammi: 0-100, hidden when reliability = low */
  (CASE
    WHEN n.reliability = 'low' THEN NULL::numeric
    ELSE ROUND(n.rain_pct_0_100::numeric, 0)
  END) AS kans_regen_pct_sammi,
  (CASE
    WHEN n.reliability = 'low' THEN NULL::numeric
    ELSE ROUND(n.thunder_pct_0_100::numeric, 0)
  END) AS kans_onweer_pct_sammi,
  (CASE
    WHEN n.reliability = 'low' THEN NULL::numeric
    ELSE ROUND(n.fog_pct_0_100::numeric, 0)
  END) AS kans_mist_pct_sammi,

  n.reliability
FROM n;

COMMENT ON VIEW public.sammi_forecast IS
  'Hourly: weather_forecast + kans_regen/onweer/mist (0-100, NULL in low) + high|medium|low reliability.';

-- 2) Daily (Bangkok calendar day) per location
CREATE OR REPLACE VIEW public.sammi_daily_forecast AS
WITH h AS (
  SELECT
    sf.location_id,
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
    h.location_id,
    h.forecast_date,
    ROUND(AVG(h.temperature_c)::numeric, 1) AS avg_temp_c,
    ROUND(MAX(h.temperature_c)::numeric, 1) AS max_temp_c,
    ROUND(MIN(h.temperature_c)::numeric, 1) AS min_temp_c,
    /* Nette %: AVG rain (ignores null hours); max thunder/mist (null if no data that day) */
    ROUND(AVG(h.kans_regen_pct_sammi)::numeric, 0) AS avg_rain_pct,
    ROUND(MAX(h.kans_onweer_pct_sammi)::numeric, 0) AS max_thunder_pct,
    ROUND(MAX(h.kans_mist_pct_sammi)::numeric, 0) AS max_mist_pct,
    MAX(h.cape) AS max_cape,
    ROUND(
      MAX(
        CASE
          WHEN h.ict_time_bkk >= time '12:00' THEN h.kans_regen_pct_sammi
        END
      )::numeric,
      0
    ) AS max_afternoon_rain_pct,
    ROUND(
      MAX(
        CASE
          WHEN h.ict_time_bkk < time '12:00' THEN h.kans_regen_pct_sammi
        END
      )::numeric,
      0
    ) AS max_morning_rain_pct,
    CASE
      WHEN bool_or(h.reliability = 'low') THEN
        'low'::text
      WHEN bool_or(h.reliability = 'medium') THEN
        'medium'::text
      ELSE
        'high'::text
    END AS reliability
  FROM h
  GROUP BY
    h.location_id,
    h.forecast_date
)
SELECT
  a.location_id,
  a.forecast_date,
  a.avg_temp_c,
  a.max_temp_c,
  a.min_temp_c,
  /* Aliases for app: nette kansen */
  a.avg_rain_pct AS kans_regen_pct_sammi,
  a.max_thunder_pct AS kans_onweer_pct_sammi,
  a.max_mist_pct AS kans_mist_pct_sammi,
  /* Backward-compatible names (English) */
  a.avg_rain_pct AS chance_of_rain_pct,
  a.max_thunder_pct AS chance_of_thunder_pct,
  a.max_mist_pct AS chance_of_fog_pct,
  a.reliability AS reliability_level,
  a.reliability,

  (CASE
    WHEN a.reliability = 'low' AND COALESCE(a.max_cape, 0::numeric) > 2000::numeric THEN
      'This far out, treat rain and storms as a broad pattern only. Use the hourly view for the next two days to time showers.'

    WHEN a.reliability = 'low' THEN
      'Long-range look only: use hourly rows for the next 48h for the most reliable detail.'

    WHEN
      (COALESCE(a.max_thunder_pct, 0::numeric) > 35::numeric
        OR COALESCE(a.max_cape, 0::numeric) > 2000::numeric)
      AND a.reliability <> 'low' THEN
      'Storms in play—have a plan B, especially in the afternoon. Check lightning and the hourly strip for timing.'

    WHEN
      COALESCE(a.max_afternoon_rain_pct, 0::numeric) > 45::numeric
      AND COALESCE(a.max_morning_rain_pct, 0::numeric) < 25::numeric
      AND COALESCE(a.avg_rain_pct, 0::numeric) > 30::numeric THEN
      'Wet leans to the afternoon; the morning is often a bit drier. Keep the hourly open for a dry window to swim.'

    WHEN COALESCE(a.avg_rain_pct, 0::numeric) > 40::numeric THEN
      'A wet-leaning day on the run—light cover helps; earlier hours can still offer sun between bands.'

    WHEN COALESCE(a.max_mist_pct, 0::numeric) > 25::numeric THEN
      'Mist or low cloud is possible, especially in the first half of the day—visibility can feel softer on the roads and water.'

    WHEN
      a.reliability = 'high'
      AND COALESCE(a.avg_rain_pct, 0::numeric) < 30::numeric
      AND COALESCE(a.max_thunder_pct, 0::numeric) < 20::numeric THEN
      'A clean window on this part of the run—enjoy the beach, keep SPF and water nearby, and use hourly for fine tuning.'

    ELSE
      'Typical warm island day—use SPF, stay hydrated, and peek at the hourly for small tweaks to pool or beach time.'
  END) AS sammi_advice
FROM agg a;

COMMENT ON VIEW public.sammi_daily_forecast IS
  'Per location + Bangkok day: min/max/avg temp, rain/thunder/mist (netted from hourly), reliability, English sammi_advice.';
