-- Prefer: supabase/SUPABASE_PASTE_ME_sammi.sql (one file, one run)
-- This file: DEEL 1 optional split. Tables, columns, archive_expired_forecasts.
-- Deel 2: INSTALL_sammi_DEEL2_backfill_en_views.sql
-- Comment lines must start with -- (no bare lines of = characters, Postgres 42601)

-- A) Tabellen (from 007)

CREATE TABLE IF NOT EXISTS weather_forecast (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id                text NOT NULL,
  valid_time_utc             timestamptz NOT NULL,
  valid_time_ict             text NOT NULL,
  issuance_time_utc          timestamptz,
  air_temperature_c          double precision,
  wind_speed_ms              double precision,
  wind_direction_deg         double precision,
  wind_gust_ms               double precision,
  total_cloud_cover          double precision,
  low_cloud_cover            double precision,
  mid_cloud_cover            double precision,
  high_cloud_cover           double precision,
  ceiling_m                  double precision,
  cape                       double precision,
  lifted_index               double precision,
  probability_of_precipitation_1hr   double precision,
  probability_of_precipitation_24hr  double precision,
  probability_of_thunderstorm        double precision,
  precipitation_rate         double precision,
  relative_humidity          double precision,
  values_json                jsonb,
  beach_score                double precision,
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, valid_time_utc)
);

CREATE TABLE IF NOT EXISTS weather_history (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id                text NOT NULL,
  valid_time_utc             timestamptz NOT NULL,
  valid_time_ict             text NOT NULL,
  issuance_time_utc          timestamptz,
  air_temperature_c          double precision,
  wind_speed_ms              double precision,
  wind_direction_deg         double precision,
  wind_gust_ms               double precision,
  total_cloud_cover          double precision,
  low_cloud_cover            double precision,
  mid_cloud_cover            double precision,
  high_cloud_cover           double precision,
  ceiling_m                  double precision,
  cape                       double precision,
  lifted_index               double precision,
  probability_of_precipitation_1hr   double precision,
  probability_of_precipitation_24hr  double precision,
  probability_of_thunderstorm        double precision,
  precipitation_rate         double precision,
  relative_humidity          double precision,
  values_json                jsonb,
  beach_score                double precision,
  updated_at                 timestamptz,
  archived_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS weather_forecast_location_valid_idx
  ON public.weather_forecast (location_id, valid_time_utc);

CREATE INDEX IF NOT EXISTS weather_history_location_valid_idx
  ON public.weather_history (location_id, valid_time_utc);

CREATE INDEX IF NOT EXISTS weather_history_archived_idx
  ON public.weather_history (archived_at DESC);

-- B) Missing columns: align with engine 008+009

ALTER TABLE public.weather_forecast
  ADD COLUMN IF NOT EXISTS radar_status text;
ALTER TABLE public.weather_history
  ADD COLUMN IF NOT EXISTS radar_status text;

ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS issuance_time_utc timestamptz;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS air_temperature_c double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS wind_speed_ms double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS wind_direction_deg double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS wind_gust_ms double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS total_cloud_cover double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS low_cloud_cover double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS mid_cloud_cover double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS high_cloud_cover double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS ceiling_m double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS cape double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS lifted_index double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS probability_of_precipitation_1hr double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS probability_of_precipitation_24hr double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS probability_of_thunderstorm double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS precipitation_rate double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS relative_humidity double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS values_json jsonb;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS beach_score double precision;
ALTER TABLE public.weather_forecast ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- C) probability_of_fog column 010/014

ALTER TABLE public.weather_forecast
  ADD COLUMN IF NOT EXISTS probability_of_fog double precision;
ALTER TABLE public.weather_history
  ADD COLUMN IF NOT EXISTS probability_of_fog double precision;

COMMENT ON COLUMN public.weather_forecast.radar_status IS
  'RainViewer tile sample at pin: clear | rain | unknown';
COMMENT ON COLUMN public.weather_forecast.probability_of_fog IS
  'OPF/Spire fog; optional; often ook in values_json.';

-- D) archive_expired_forecasts (radar + fog)

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

COMMENT ON TABLE public.weather_forecast IS 'Latest hybrid Spire OPF + standard; upsert hourly.';
COMMENT ON TABLE public.weather_history IS 'Expired forecast rows; archived for evaluation.';

-- DEEL 1 klaar. Draai daarna: INSTALL_sammi_DEEL2_backfill_en_views.sql
