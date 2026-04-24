-- ML / pairing: explicit provider + version + future GW3001 link
-- (Run after 017_weather_validation.sql)

ALTER TABLE public.weather_validation
  ADD COLUMN IF NOT EXISTS reference_grid_provider text NOT NULL DEFAULT 'meteoblue',
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT '1',
  ADD COLUMN IF NOT EXISTS observation_at_utc timestamptz NULL,
  ADD COLUMN IF NOT EXISTS observation_source text NULL
    CHECK (observation_source IS NULL OR observation_source IN ('gw3001', 'ecowitt', 'metar', 'merged'));

COMMENT ON COLUMN public.weather_validation.reference_grid_provider IS
  'Second model in reference_grid_snapshot (default meteoblue; internal only).';
COMMENT ON COLUMN public.weather_validation.schema_version IS
  'Batch tag for export/retrain (bump when spire_snapshot keys change).';
COMMENT ON COLUMN public.weather_validation.observation_at_utc IS
  'When ground observation (GW3001) applies vs forecast_valid_utc if different';
COMMENT ON COLUMN public.weather_validation.observation_source IS
  'Optional label for observation json (gw3001, ecowitt, metar, merged)';
