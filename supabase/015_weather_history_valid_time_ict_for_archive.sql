-- Align weather_history with archive_expired_forecasts (007/008/010). Missing column:
-- column "valid_time_ict" of relation "weather_history" does not exist
-- Run once in Supabase SQL Editor, then re-run the hourly engine.

ALTER TABLE public.weather_history
  ADD COLUMN IF NOT EXISTS valid_time_ict text;

-- Vul de kolom als je al regels in weather_history hebt (zonder bestaande labels te wissen)
UPDATE public.weather_history h
SET valid_time_ict =
  to_char(timezone('Asia/Bangkok'::text, h.valid_time_utc), 'YYYY-MM-DD HH24:MI') || ' ICT'
WHERE h.valid_time_ict IS NULL
  OR btrim(h.valid_time_ict) = '';

-- Zelfde weergave als weather_engine_hourly to_ict_label; niet TO_CHAR(... ' HH24:MI:SS') zonder ' ICT',
-- anders wijkt archive af van weather_forecast.

COMMENT ON COLUMN public.weather_history.valid_time_ict IS
  'Asia/Bangkok label; mirrors weather_forecast.valid_time_ict when archived.';

-- Optional: ALTER TABLE public.weather_history ALTER COLUMN valid_time_ict SET NOT NULL;
