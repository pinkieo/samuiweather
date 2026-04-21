-- Align live Supabase with weather_engine_hourly.py + 007/008 when the table
-- was created manually or an older migration was applied.
-- Run in SQL Editor (safe: IF NOT EXISTS per column).

ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS issuance_time_utc timestamptz;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS air_temperature_c double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS wind_speed_ms double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS wind_direction_deg double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS wind_gust_ms double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS total_cloud_cover double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS low_cloud_cover double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS mid_cloud_cover double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS high_cloud_cover double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS ceiling_m double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS cape double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS lifted_index double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS probability_of_precipitation_1hr double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS probability_of_precipitation_24hr double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS probability_of_thunderstorm double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS precipitation_rate double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS relative_humidity double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS values_json jsonb;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS beach_score double precision;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS radar_status text;
ALTER TABLE weather_forecast ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- PostgREST schema cache: usually refreshes within ~1 min; or restart project if upsert still errors.
