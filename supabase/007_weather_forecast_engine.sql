-- ============================================================
-- Weather engine: rolling forecast + history for accuracy eval
-- Run in Supabase SQL Editor
-- ============================================================

-- Current forecast (latest Spire merge) — small rolling window
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

CREATE INDEX IF NOT EXISTS weather_forecast_location_valid_idx
  ON weather_forecast (location_id, valid_time_utc);

-- Archived rows (expired valid_time) for backtesting
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

CREATE INDEX IF NOT EXISTS weather_history_location_valid_idx
  ON weather_history (location_id, valid_time_utc);

CREATE INDEX IF NOT EXISTS weather_history_archived_idx
  ON weather_history (archived_at DESC);

COMMENT ON TABLE weather_forecast IS 'Latest hybrid Spire OPF + standard; upsert hourly.';
COMMENT ON TABLE weather_history IS 'Expired forecast rows moved here with issuance_time for evaluation.';

-- Move past valid_time from forecast → history (called before hourly upsert)
CREATE OR REPLACE FUNCTION archive_expired_forecasts(p_location_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  WITH moved AS (
    DELETE FROM weather_forecast
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
      precipitation_rate,
      relative_humidity,
      values_json,
      beach_score,
      updated_at
  )
  INSERT INTO weather_history (
    location_id, valid_time_utc, valid_time_ict, issuance_time_utc,
    air_temperature_c, wind_speed_ms, wind_direction_deg, wind_gust_ms,
    total_cloud_cover, low_cloud_cover, mid_cloud_cover, high_cloud_cover,
    ceiling_m, cape, lifted_index,
    probability_of_precipitation_1hr, probability_of_precipitation_24hr,
    probability_of_thunderstorm, precipitation_rate, relative_humidity,
    values_json, beach_score, updated_at, archived_at
  )
  SELECT
    location_id, valid_time_utc, valid_time_ict, issuance_time_utc,
    air_temperature_c, wind_speed_ms, wind_direction_deg, wind_gust_ms,
    total_cloud_cover, low_cloud_cover, mid_cloud_cover, high_cloud_cover,
    ceiling_m, cape, lifted_index,
    probability_of_precipitation_1hr, probability_of_precipitation_24hr,
    probability_of_thunderstorm, precipitation_rate, relative_humidity,
    values_json, beach_score, updated_at,
    now()
  FROM moved;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN COALESCE(n, 0);
END;
$$;
