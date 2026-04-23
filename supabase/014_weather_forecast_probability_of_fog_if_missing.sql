-- Ensure OPF / Spire fog column exists (same as 010, idempotent for projects that
-- ran 007–009 but never applied 010_sammi_forecast_view.sql).
-- Run in Supabase SQL Editor if weather_engine upsert errors with
--  PGRST204 — Could not find the 'probability_of_fog' column of 'weather_forecast'.

ALTER TABLE public.weather_forecast
  ADD COLUMN IF NOT EXISTS probability_of_fog double precision;

ALTER TABLE public.weather_history
  ADD COLUMN IF NOT EXISTS probability_of_fog double precision;

COMMENT ON COLUMN public.weather_forecast.probability_of_fog IS
  'OPF / Spire fog probability (0–100), hourly overlay; optional.';

-- If 010 was never applied, archive_expired_forecasts from 010 may also be missing.
-- Re-apply 010 in full, or at minimum: after this script, if archive RPC still fails,
-- run supabase/010_sammi_forecast_view.sql (replaces archive function + sammi view).
