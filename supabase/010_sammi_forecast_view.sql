-- Sammi: probability columns + sammi_forecast view (reliability bands vs issuance)
-- Run in Supabase SQL Editor after 008_weather_forecast_radar_status.sql

ALTER TABLE public.weather_forecast
  ADD COLUMN IF NOT EXISTS probability_of_fog double precision;

ALTER TABLE public.weather_history
  ADD COLUMN IF NOT EXISTS probability_of_fog double precision;

COMMENT ON COLUMN public.weather_forecast.probability_of_fog IS
  'OPF / Spire fog probability (0–100), hourly overlay; optional.';

-- Carry probability_of_fog into history when archiving
CREATE OR REPLACE FUNCTION public.archive_expired_forecasts(p_location_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  WITH moved AS (
    DELETE FROM public.weather_forecast
    WHERE location_id = p_location_id
      AND valid_time_utc < now()
    RETURNING
      location_id,
      valid_time_utc,
      valid_time_ict,
      issuance_time_utc,
      air_temperature_c,
      wind_speed_ms,
      wind_direction_deg,
      wind_gust_ms,
      total_cloud_cover,
      low_cloud_cover,
      mid_cloud_cover,
      high_cloud_cover,
      ceiling_m,
      cape,
      lifted_index,
      probability_of_precipitation_1hr,
      probability_of_precipitation_24hr,
      probability_of_thunderstorm,
      probability_of_fog,
      precipitation_rate,
      relative_humidity,
      values_json,
      beach_score,
      radar_status,
      updated_at
  )
  INSERT INTO public.weather_history (
    location_id, valid_time_utc, valid_time_ict, issuance_time_utc,
    air_temperature_c, wind_speed_ms, wind_direction_deg, wind_gust_ms,
    total_cloud_cover, low_cloud_cover, mid_cloud_cover, high_cloud_cover,
    ceiling_m, cape, lifted_index,
    probability_of_precipitation_1hr, probability_of_precipitation_24hr,
    probability_of_thunderstorm, probability_of_fog, precipitation_rate, relative_humidity,
    values_json, beach_score, radar_status, updated_at, archived_at
  )
  SELECT
    location_id, valid_time_utc, valid_time_ict, issuance_time_utc,
    air_temperature_c, wind_speed_ms, wind_direction_deg, wind_gust_ms,
    total_cloud_cover, low_cloud_cover, mid_cloud_cover, high_cloud_cover,
    ceiling_m, cape, lifted_index,
    probability_of_precipitation_1hr, probability_of_precipitation_24hr,
    probability_of_thunderstorm, probability_of_fog, precipitation_rate, relative_humidity,
    values_json, beach_score, radar_status, updated_at,
    now()
  FROM moved;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN COALESCE(n, 0);
END;
$$;

-- Sammi-facing slice: probabilities + reliability vs issuance (48h / 120h / 360h plan)
--   hoog 0–48h: exacte % (OPF) — toon kans_*_sammi
--   medium 48–120h: % indien beschikbaar; anders Sammi range-taal (app/LLM)
--   laag 120–360h: geen harde % in Sammi — kans_*_sammi NULL; trend + CAPE
CREATE OR REPLACE VIEW public.sammi_forecast AS
SELECT
  s.location_id,
  s.issuance_time_utc,
  s.valid_time_utc,
  s.valid_time_ict,
  s.temperature_c,
  s.kans_regen_pct,
  s.kans_onweer_pct,
  s.kans_mist_pct,
  CASE WHEN s.reliability = 'laag' THEN NULL ELSE s.kans_regen_pct END AS kans_regen_pct_sammi,
  CASE WHEN s.reliability = 'laag' THEN NULL ELSE s.kans_onweer_pct END AS kans_onweer_pct_sammi,
  CASE WHEN s.reliability = 'laag' THEN NULL ELSE s.kans_mist_pct END AS kans_mist_pct_sammi,
  s.cape,
  s.resolution,
  s.reliability,
  CASE
    WHEN s.reliability = 'laag' AND COALESCE(s.cape, 0) > 2000 THEN
      'Verder in de week kans op buien, vooral rond het middaguur · Mid-week PM convection trend'
    WHEN s.reliability = 'laag' THEN
      'Verder in de week alleen trend (geen harde %) · Further out: qualitative trend only'
    WHEN COALESCE(s.kans_onweer_pct, 0) > 30 OR COALESCE(s.cape, 0) > 2000 THEN
      'Onweer mogelijk – blijf alert · Thunder possible — stay alert'
    WHEN COALESCE(s.kans_regen_pct, 0) > 40 THEN
      'Kans op bui, vooral middag · Shower chance, especially afternoon'
    WHEN COALESCE(s.kans_mist_pct, 0) > 20 THEN
      'Mist mogelijk · Fog possible'
    ELSE
      'Goede beach condities · Good beach conditions'
  END AS samui_advice
FROM (
  SELECT
    wf.location_id,
    wf.issuance_time_utc,
    wf.valid_time_utc,
    wf.valid_time_ict,
    wf.air_temperature_c AS temperature_c,
    wf.probability_of_precipitation_1hr AS kans_regen_pct,
    wf.probability_of_thunderstorm AS kans_onweer_pct,
    COALESCE(
      wf.probability_of_fog,
      (wf.values_json->>'probability_of_fog')::double precision
    ) AS kans_mist_pct,
    wf.cape,
    CASE
      WHEN wf.valid_time_utc <= COALESCE(wf.issuance_time_utc, wf.updated_at) + interval '48 hours' THEN
        'hourly'
      WHEN wf.valid_time_utc <= COALESCE(wf.issuance_time_utc, wf.updated_at) + interval '120 hours' THEN
        'mixed'
      ELSE
        '6_hourly_trend'
    END AS resolution,
    CASE
      WHEN wf.valid_time_utc <= COALESCE(wf.issuance_time_utc, wf.updated_at) + interval '48 hours' THEN
        'hoog'
      WHEN wf.valid_time_utc <= COALESCE(wf.issuance_time_utc, wf.updated_at) + interval '120 hours' THEN
        'medium'
      ELSE
        'laag'
    END AS reliability
  FROM public.weather_forecast wf
  WHERE wf.valid_time_utc >= now() - interval '12 hours'
) s
ORDER BY s.location_id, s.valid_time_utc;

COMMENT ON VIEW public.sammi_forecast IS
  'Sammi: reliability hoog ≤48h, medium ≤120h, laag >120h from issuance; hide hard % in laag via kans_*_sammi.';
