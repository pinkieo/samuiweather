-- UV index on the rolling forecast, its archive, and the issuance snapshot.
-- Spire's subscribed point bundles do not include this field. Ingest stores
-- a Spire index when one is present, otherwise the exact-hour OpenUV forecast.
-- Null means that hour had no index. Do not backfill a zero.

ALTER TABLE public.weather_forecast
  ADD COLUMN IF NOT EXISTS uv_index double precision;

ALTER TABLE public.weather_history
  ADD COLUMN IF NOT EXISTS uv_index double precision;

ALTER TABLE public.weather_forecast_snapshot
  ADD COLUMN IF NOT EXISTS uv_index double precision;

COMMENT ON COLUMN public.weather_forecast.uv_index IS
  'UV index for this valid hour. Spire when the point payload has one, otherwise OpenUV exact UTC hour. Null when neither sent an index.';

-- Archive function: 020 shape plus uv_index.
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
      pwat,
      dcape,
      cin,
      probability_of_precipitation_1hr,
      probability_of_precipitation_24hr,
      probability_of_thunderstorm,
      probability_of_fog,
      precipitation_rate,
      relative_humidity,
      uv_index,
      values_json,
      beach_score,
      radar_status,
      updated_at
  )
  INSERT INTO public.weather_history (
    location_id, valid_time_utc, valid_time_ict, issuance_time_utc,
    air_temperature_c, wind_speed_ms, wind_direction_deg, wind_gust_ms,
    total_cloud_cover, low_cloud_cover, mid_cloud_cover, high_cloud_cover,
    ceiling_m, cape, lifted_index, pwat, dcape, cin,
    probability_of_precipitation_1hr, probability_of_precipitation_24hr,
    probability_of_thunderstorm, probability_of_fog, precipitation_rate, relative_humidity,
    uv_index,
    values_json, beach_score, radar_status, updated_at, archived_at
  )
  SELECT
    location_id, valid_time_utc, valid_time_ict, issuance_time_utc,
    air_temperature_c, wind_speed_ms, wind_direction_deg, wind_gust_ms,
    total_cloud_cover, low_cloud_cover, mid_cloud_cover, high_cloud_cover,
    ceiling_m, cape, lifted_index, pwat, dcape, cin,
    probability_of_precipitation_1hr, probability_of_precipitation_24hr,
    probability_of_thunderstorm, probability_of_fog, precipitation_rate, relative_humidity,
    uv_index,
    values_json, beach_score, radar_status, updated_at,
    now()
  FROM moved;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN COALESCE(n, 0);
END;
$$;
