-- 014: probability_of_fog as a real column on weather_forecast (+ history) for PostgREST + clean queries.
-- Run in Supabase SQL Editor.
--
-- After this file succeeds, run 013 in the same editor (or paste) so `sammi_forecast` reads the column
-- and uses kans_mist_pct_sammi from fog. File: 013_sammi_forecast_views.sql (replaces two views idempotently).
--
-- PostgREST schema cache may take ~1 min to see new columns, or use Dashboard → API → restart.

-- 1) Columns (idempotent; same as 010 for forecast/history for projects that never ran 010)
ALTER TABLE public.weather_forecast
  ADD COLUMN IF NOT EXISTS probability_of_fog double precision;

ALTER TABLE public.weather_history
  ADD COLUMN IF NOT EXISTS probability_of_fog double precision;

COMMENT ON COLUMN public.weather_forecast.probability_of_fog IS
  'OPF/Spire fog (0–100 or 0–1 from model); optional; also mirrored in values_json.';

-- 2) Backfill from JSON for rows the hourly engine ingested before the column existed
UPDATE public.weather_forecast wf
SET probability_of_fog = (wf.values_json->>'probability_of_fog')::double precision
WHERE wf.probability_of_fog IS NULL
  AND wf.values_json ? 'probability_of_fog'
  AND btrim(wf.values_json->>'probability_of_fog', ' ') <> '';

-- (Do *not* blanket-set NULL to 0 — that erases “unknown” vs “no fog”.)

-- 3) Optional index (low-cardinality; drop if you prefer location+time only)
CREATE INDEX IF NOT EXISTS idx_weather_forecast_probability_of_fog
  ON public.weather_forecast (probability_of_fog);

-- 4) Rebuild Sammi views from repo file `013_sammi_forecast_views.sql` (CREATE OR REPLACE both views)
--     so `kans_mist_pct_sammi` uses the new column + `values_json` fallback.
