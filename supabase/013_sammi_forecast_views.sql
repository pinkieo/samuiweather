-- Sammi views v2 — aligned with app column names + English reliability (high / medium / low)
-- Source: public.weather_forecast (007/009 schema). Run in Supabase SQL Editor.
--
-- Maps legacy columns → view output:
--   air_temperature_c → temperature_c; wind_speed_ms → wind_speed; wind_gust_ms → wind_gust;
--   updated_at → last_updated; POP/thunder normalized to 0–1 for precip_prob_1h then *100 in *_sammi.

CREATE OR REPLACE VIEW public.sammi_forecast AS
WITH src AS (
  SELECT
    wf.issuance_time_utc,
    wf.valid_time_utc,
    wf.valid_time_ict,
    wf.air_temperature_c AS temperature_c,
    ROUND(
      ((wf.air_temperature_c * 9.0 / 5.0) + 32.0)::numeric,
      1
    ) AS temperature_f,
    wf.precipitation_rate,
    (
      CASE
        WHEN wf.probability_of_precipitation_1hr IS NULL THEN NULL::numeric
        WHEN wf.probability_of_precipitation_1hr::numeric <= 1 THEN wf.probability_of_precipitation_1hr::numeric
        ELSE (wf.probability_of_precipitation_1hr::numeric / 100.0)
      END
    ) AS precip_prob_1h,
    wf.probability_of_thunderstorm,
    wf.cape,
    wf.lifted_index,
    wf.wind_speed_ms AS wind_speed,
    wf.wind_gust_ms AS wind_gust,
    wf.wind_direction_deg,
    wf.total_cloud_cover,
    wf.beach_score,
    wf.values_json,
    CASE
      WHEN wf.valid_time_utc <= COALESCE(wf.issuance_time_utc, wf.updated_at) + interval '48 hours' THEN
        'hourly'::text
      WHEN wf.valid_time_utc <= COALESCE(wf.issuance_time_utc, wf.updated_at) + interval '120 hours' THEN
        'mixed'::text
      ELSE
        '6_hourly_trend'::text
    END AS resolution,
    wf.updated_at AS last_updated
  FROM public.weather_forecast wf
  WHERE wf.valid_time_utc >= (now() - interval '12 hours')
)
SELECT
  s.issuance_time_utc,
  s.valid_time_utc,
  s.valid_time_ict,
  s.temperature_c,
  s.temperature_f,
  s.precipitation_rate,
  s.precip_prob_1h,
  s.probability_of_thunderstorm,
  s.cape,
  s.lifted_index,
  s.wind_speed,
  s.wind_gust,
  s.wind_direction_deg,
  s.total_cloud_cover,
  s.beach_score,
  s.values_json,
  s.resolution,
  s.last_updated,

  ROUND((COALESCE(s.precip_prob_1h, 0::numeric) * 100)::numeric, 0) AS kans_regen_pct_sammi,

  ROUND(
    (
      COALESCE(
        CASE
          WHEN s.probability_of_thunderstorm IS NULL THEN NULL::numeric
          WHEN s.probability_of_thunderstorm::numeric <= 1 THEN s.probability_of_thunderstorm::numeric
          ELSE (s.probability_of_thunderstorm::numeric / 100.0)
        END,
        0::numeric
      ) * 100
    )::numeric,
    0
  ) AS kans_onweer_pct_sammi,

  0::numeric AS kans_mist_pct_sammi,

  CASE
    WHEN s.valid_time_utc <= COALESCE(s.issuance_time_utc, s.last_updated) + interval '48 hours' THEN
      'high'::text
    WHEN s.valid_time_utc <= COALESCE(s.issuance_time_utc, s.last_updated) + interval '120 hours' THEN
      'medium'::text
    ELSE
      'low'::text
  END AS reliability
FROM src s;

COMMENT ON VIEW public.sammi_forecast IS
  'Hourly Sammi slice: weather_forecast + POP/thunder % (sammi) + reliability high≤48h medium≤120h vs issuance.';


CREATE OR REPLACE VIEW public.sammi_daily_forecast AS
WITH day_rows AS (
  SELECT
    (sf.valid_time_utc AT TIME ZONE 'Asia/Bangkok')::date AS forecast_date,
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
    CASE
      WHEN bool_or(dr.reliability = 'low') THEN 'low'::text
      WHEN bool_or(dr.reliability = 'medium') THEN 'medium'::text
      ELSE 'high'::text
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
    WHEN a.reliability_level = 'low' AND COALESCE(a.max_cape, 0) > 2000 THEN
      'Further out: elevated thunder risk around midday — treat as a trend only, not exact timing.'
    WHEN a.reliability_level = 'low' THEN
      'Further out: qualitative trend only — percentages are intentionally muted for this horizon.'
    WHEN COALESCE(a.chance_of_thunderstorm_pct, 0) > 35 OR COALESCE(a.max_cape, 0) > 2000 THEN
      'Thunderstorms possible in the afternoon — plan indoor backup after 3 PM.'
    WHEN COALESCE(a.chance_of_rain_pct, 0) > 40 THEN
      'Good chance of short showers, especially in the afternoon.'
    WHEN COALESCE(a.chance_of_fog_pct, 0) > 25 THEN
      'Morning mist or low visibility is possible — go easy on early beach runs.'
    WHEN a.reliability_level = 'high' THEN
      'Looks like a solid beach day with the most reliable part of the forecast window.'
    ELSE
      'Typical Samui conditions — enjoy the sun and stay hydrated.'
  END AS sammi_advice
FROM agg a;

COMMENT ON VIEW public.sammi_daily_forecast IS
  'One row per Bangkok calendar day: temps, rounded chances, conservative reliability_level, English sammi_advice.';
