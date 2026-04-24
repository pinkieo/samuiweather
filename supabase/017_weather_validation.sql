-- Skill / ML: paired snapshots — Spire-led row vs interne referentie-grid vs (later) bodemwaarheid
-- RLS: service role (cron) schrijft; geen public read tenzij je later een policy toevoegt.
-- "reference_grid_snapshot" = tweede model (nu via zelfde bron als vroeger in UI) — geen grondwaarheid.

CREATE TABLE IF NOT EXISTS public.weather_validation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id text NOT NULL,
  forecast_valid_utc timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  spire_snapshot jsonb NOT NULL,
  reference_grid_snapshot jsonb NULL,
  observation jsonb NULL
);

CREATE INDEX IF NOT EXISTS idx_weather_validation_location_time
  ON public.weather_validation (location_id, forecast_valid_utc DESC);

CREATE INDEX IF NOT EXISTS idx_weather_validation_captured
  ON public.weather_validation (captured_at DESC);

COMMENT ON TABLE public.weather_validation IS
  'Append-only: Spire row snapshot + optioneel referentie-grid voor benchmarking; observation = later Ecowitt/METAR truth.';

ALTER TABLE public.weather_validation ENABLE ROW LEVEL SECURITY;
