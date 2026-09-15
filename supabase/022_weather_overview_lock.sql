-- 4× daily ICT overview lock: which weather_forecast_snapshot issuance is
-- the morning / midday / evening / overnight product lock.
-- Rows in weather_forecast_snapshot stay the provenance; this table only
-- names the slot.

CREATE TABLE IF NOT EXISTS public.weather_overview_lock (
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
  summary_json jsonb,
  locked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weather_overview_lock_slot_key
    UNIQUE (location_id, slot_date_ict, slot)
);

CREATE INDEX IF NOT EXISTS weather_overview_lock_date_idx
  ON public.weather_overview_lock (location_id, slot_date_ict DESC);

ALTER TABLE public.weather_overview_lock ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.weather_overview_lock IS
  'One locked Spire+OPF issuance per ICT slot (00/06/12/18). Points at weather_forecast_snapshot; does not replace it.';
