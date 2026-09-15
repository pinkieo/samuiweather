-- Canonical 4× ICT slot lock. One row per location + ICT date + slot.
-- Forecast blob is frozen at lock time; verification is filled later.
-- weather_forecast_snapshot remains the hourly provenance table.

CREATE TABLE IF NOT EXISTS public.daily_forecast_slot_lock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id text NOT NULL,
  slot_date_ict date NOT NULL,
  slot text NOT NULL
    CHECK (slot IN ('0000', '0600', '1200', '1800')),
  issuance_time_utc timestamptz NOT NULL,
  retrieved_at_utc timestamptz,
  opf_overlay_applied boolean NOT NULL DEFAULT false,
  source_composition jsonb,
  lead_hours_min double precision,
  lead_hours_max double precision,
  hour_count integer,
  forecast_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_json jsonb,
  verified_at timestamptz,
  locked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_forecast_slot_lock_slot_key
    UNIQUE (location_id, slot_date_ict, slot)
);

CREATE INDEX IF NOT EXISTS daily_forecast_slot_lock_date_idx
  ON public.daily_forecast_slot_lock (location_id, slot_date_ict DESC);

ALTER TABLE public.daily_forecast_slot_lock ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.daily_forecast_slot_lock IS
  'One locked Spire Standard Point + OPF issuance per ICT slot. forecast_json is immutable after first lock; verification_json is filled after the slot window.';
COMMENT ON COLUMN public.daily_forecast_slot_lock.forecast_json IS
  'Frozen hours, tourist summary, Standard Point temps/wind, OPF POP/thunder/fog.';
COMMENT ON COLUMN public.daily_forecast_slot_lock.verification_json IS
  'Raw Ecowitt comparison for the slot window. Rain millimetres uncalibrated.';

-- Copy any rows from the earlier pointer table if it exists.
DO $$
BEGIN
  IF to_regclass('public.weather_overview_lock') IS NOT NULL THEN
    INSERT INTO public.daily_forecast_slot_lock (
      location_id, slot_date_ict, slot, issuance_time_utc, retrieved_at_utc,
      opf_overlay_applied, source_composition, lead_hours_min, lead_hours_max,
      hour_count, forecast_json, locked_at
    )
    SELECT
      location_id, slot_date_ict, slot, issuance_time_utc, retrieved_at_utc,
      opf_overlay_applied, source_composition, lead_hours_min, lead_hours_max,
      hour_count, COALESCE(summary_json, '{}'::jsonb), locked_at
    FROM public.weather_overview_lock
    ON CONFLICT (location_id, slot_date_ict, slot) DO NOTHING;
  END IF;
END $$;
