-- Paired Spire (weather_history) vs Ecowitt ground truth for bias / ML.
-- Populated by scripts/backfill-forecast-verification.py

CREATE TABLE IF NOT EXISTS public.forecast_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id text NOT NULL DEFAULT 'samui_opf_hybrid',
  forecast_valid_utc timestamptz NOT NULL,
  forecast_issued_utc timestamptz NULL,
  lead_hours double precision NULL,
  spire_snapshot jsonb NOT NULL,
  observed_at_utc timestamptz NOT NULL,
  observation_source text NOT NULL,
  observation jsonb NOT NULL,
  errors_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, forecast_valid_utc, observation_source, observed_at_utc)
);

CREATE INDEX IF NOT EXISTS idx_forecast_verification_valid
  ON public.forecast_verification (forecast_valid_utc DESC);

CREATE INDEX IF NOT EXISTS idx_forecast_verification_location
  ON public.forecast_verification (location_id, forecast_valid_utc DESC);

COMMENT ON TABLE public.forecast_verification IS
  'Spire archived forecast vs Ecowitt observation; used for bias correction and Samui ML point.';

ALTER TABLE public.forecast_verification ENABLE ROW LEVEL SECURITY;
