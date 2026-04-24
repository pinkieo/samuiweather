-- PWAT, DCAPE, CIN as first-class columns (thunderstorm bundle / guide Tier 1–2)
-- Run after 014 (and 010 archive shape). Rebuild `archive_expired_forecasts` to copy these to history.
-- After: run 013 (sammi views) or rely on 013’s COALESCE if already deployed.

ALTER TABLE public.weather_forecast
  ADD COLUMN IF NOT EXISTS pwat double precision,
  ADD COLUMN IF NOT EXISTS dcape double precision,
  ADD COLUMN IF NOT EXISTS cin double precision;

ALTER TABLE public.weather_history
  ADD COLUMN IF NOT EXISTS pwat double precision,
  ADD COLUMN IF NOT EXISTS dcape double precision,
  ADD COLUMN IF NOT EXISTS cin double precision;

COMMENT ON COLUMN public.weather_forecast.pwat IS
  'Precipitable water (kg m⁻²) — same as mm column water; thunderstorm / moisture bundle.';
COMMENT ON COLUMN public.weather_forecast.dcape IS
  'Downdraft CAPE (J kg⁻¹) — gusty outflow risk; thunderstorm bundle.';
COMMENT ON COLUMN public.weather_forecast.cin IS
  'Convective inhibition (J kg⁻¹), typically ≤ 0; thunderstorm / profile.';

-- Backfill from values_json (engine previously stored only in JSON)
UPDATE public.weather_forecast wf
SET pwat = COALESCE(
  (NULLIF(btrim(wf.values_json->>'precipitable_water'), ''))::double precision,
  (NULLIF(btrim(wf.values_json->>'precipitable_water_entire_atmosphere'), ''))::double precision,
  (NULLIF(btrim(wf.values_json->>'total_column_integrated_water_vapour'), ''))::double precision,
  (NULLIF(btrim(wf.values_json->>'tcw'), ''))::double precision
)
WHERE wf.pwat IS NULL
  AND wf.values_json IS NOT NULL
  AND (
    wf.values_json ? 'precipitable_water'
    OR wf.values_json ? 'precipitable_water_entire_atmosphere'
    OR wf.values_json ? 'total_column_integrated_water_vapour'
    OR wf.values_json ? 'tcw'
  );

UPDATE public.weather_forecast wf
SET dcape = COALESCE(
  (NULLIF(btrim(wf.values_json->>'downdraft_cape'), ''))::double precision,
  (NULLIF(btrim(wf.values_json->>'downdraft_CAPE'), ''))::double precision,
  (NULLIF(btrim(wf.values_json->>'dcape'), ''))::double precision
)
WHERE wf.dcape IS NULL
  AND wf.values_json IS NOT NULL
  AND (
    wf.values_json ? 'downdraft_cape'
    OR wf.values_json ? 'downdraft_CAPE'
    OR wf.values_json ? 'dcape'
  );

UPDATE public.weather_forecast wf
SET cin = COALESCE(
  (NULLIF(btrim(wf.values_json->>'convective_inhibition'), ''))::double precision,
  (NULLIF(btrim(wf.values_json->>'cin'), ''))::double precision,
  (NULLIF(btrim(wf.values_json->>'CIN'), ''))::double precision
)
WHERE wf.cin IS NULL
  AND wf.values_json IS NOT NULL
  AND (
    wf.values_json ? 'convective_inhibition'
    OR wf.values_json ? 'cin'
    OR wf.values_json ? 'CIN'
  );

-- Archive function: keep in sync with 010 (probability_of_fog) + 020
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
    values_json, beach_score, radar_status, updated_at, archived_at
  )
  SELECT
    location_id, valid_time_utc, valid_time_ict, issuance_time_utc,
    air_temperature_c, wind_speed_ms, wind_direction_deg, wind_gust_ms,
    total_cloud_cover, low_cloud_cover, mid_cloud_cover, high_cloud_cover,
    ceiling_m, cape, lifted_index, pwat, dcape, cin,
    probability_of_precipitation_1hr, probability_of_precipitation_24hr,
    probability_of_thunderstorm, probability_of_fog, precipitation_rate, relative_humidity,
    values_json, beach_score, radar_status, updated_at,
    now()
  FROM moved;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN COALESCE(n, 0);
END;
$$;
