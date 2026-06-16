-- =============================================================================
-- ML data collection: RainViewer + Spire numeric features (no radar images)
-- =============================================================================
-- Append-only rows for supervised learning: rain onset windows, storm motion,
-- “hits the beach” style labels. Label columns stay NULL until filled from
-- stations, radar truth, or human review. Intended ingest: cron / Edge Function
-- every ~10–15 minutes per location (e.g. Koh Samui).

CREATE TABLE IF NOT EXISTS public.rain_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- When this sample row was produced (ingest wall clock, UTC).
  observed_at timestamptz NOT NULL,

  -- Stable site key, e.g. samui, krabi_baan_mook_taley (align with app regions).
  location text NOT NULL,

  -- RainViewer: frame validity time (UTC) for the echo used; no tile blobs stored.
  rainviewer_timestamp timestamptz NULL,

  -- Inferred or modelled rain rate at the pin (mm/h).
  rain_rate_mmh numeric NULL,

  wind_speed_kmh numeric NULL,
  wind_direction_deg numeric NULL,

  spire_cape numeric NULL,
  spire_pwat numeric NULL,
  spire_cin numeric NULL,
  -- Spire thunder bundle: DCAPE (J/kg); column name kept short for SQL ergonomics.
  spire_dcape numeric NULL,
  spire_thunderstorm_prob numeric NULL,

  -- Supervision targets — to be backfilled (Ecowitt, METAR, analyst, etc.).
  label_rain_in_30min boolean NULL,
  label_rain_in_60min boolean NULL,
  label_rain_in_90min boolean NULL,
  label_heavy_rain boolean NULL,
  label_storm_hits_coast boolean NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rain_observations_location_observed
  ON public.rain_observations (location, observed_at DESC);

COMMENT ON TABLE public.rain_observations IS
  'Numeric-only feature store for RainViewer + Spire; ML labels optional until truth is linked.';

COMMENT ON COLUMN public.rain_observations.label_rain_in_30min IS
  'Supervised label: measurable rain within 30 min after observed_at; NULL until derived.';

COMMENT ON COLUMN public.rain_observations.label_storm_hits_coast IS
  'Supervised label: convective / heavy rain impacts coast near pin; NULL until derived.';

ALTER TABLE public.rain_observations ENABLE ROW LEVEL SECURITY;
