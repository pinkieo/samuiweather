-- =============================================================================
-- Ecowitt ground-truth observations: Baan Ton Kluay, Koh Samui
-- =============================================================================
-- Raw station uploads plus normalized metric columns for forecast verification and ML.
-- Ingest path: app/api/ecowitt/ingest/route.ts using SUPABASE_SERVICE_ROLE_KEY.

CREATE TABLE IF NOT EXISTS public.ecowitt_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  observed_at timestamptz NOT NULL,
  location_id text NOT NULL DEFAULT 'baan_ton_kluay',

  station_type text NULL,
  station_id text NULL,

  temperature_c double precision NULL,
  humidity_pct double precision NULL,
  indoor_temperature_c double precision NULL,
  indoor_humidity_pct double precision NULL,

  relative_pressure_hpa double precision NULL,
  absolute_pressure_hpa double precision NULL,

  wind_speed_ms double precision NULL,
  wind_gust_ms double precision NULL,
  wind_direction_deg double precision NULL,

  rain_rate_mmh double precision NULL,
  rain_hour_mm double precision NULL,
  rain_day_mm double precision NULL,
  rain_week_mm double precision NULL,
  rain_month_mm double precision NULL,
  rain_year_mm double precision NULL,
  rain_event_mm double precision NULL,

  solar_wm2 double precision NULL,
  uv_index double precision NULL,

  lightning_distance_km double precision NULL,
  lightning_count integer NULL,

  battery_status jsonb NULL,
  raw_json jsonb NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ecowitt_observations_location_observed
  ON public.ecowitt_observations (location_id, observed_at);

CREATE INDEX IF NOT EXISTS idx_ecowitt_observations_created
  ON public.ecowitt_observations (created_at DESC);

COMMENT ON TABLE public.ecowitt_observations IS
  'Raw and normalized Ecowitt weather station observations for Baan Ton Kluay ground-truth ML.';

ALTER TABLE public.ecowitt_observations ENABLE ROW LEVEL SECURITY;
