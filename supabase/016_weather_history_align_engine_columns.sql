-- weather_history may exist with only a subset of columns (older/minimal create).
-- archive_expired_forecasts (010) inserts the full forecast row; add any missing columns.
-- Run after 015. Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS issuance_time_utc timestamptz;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS air_temperature_c double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS wind_speed_ms double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS wind_direction_deg double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS wind_gust_ms double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS total_cloud_cover double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS low_cloud_cover double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS mid_cloud_cover double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS high_cloud_cover double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS ceiling_m double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS cape double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS lifted_index double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS pwat double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS dcape double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS cin double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS probability_of_precipitation_1hr double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS probability_of_precipitation_24hr double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS probability_of_thunderstorm double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS probability_of_fog double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS precipitation_rate double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS relative_humidity double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS values_json jsonb;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS beach_score double precision;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS radar_status text;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.weather_history ADD COLUMN IF NOT EXISTS archived_at timestamptz;
-- if table had no default:
UPDATE public.weather_history SET archived_at = coalesce(archived_at, now()) WHERE archived_at IS NULL;
ALTER TABLE public.weather_history ALTER COLUMN archived_at SET DEFAULT now();
ALTER TABLE public.weather_history ALTER COLUMN archived_at SET NOT NULL;
