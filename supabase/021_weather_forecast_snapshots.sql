-- Preserve every hourly Spire forecast issuance without changing the
-- operational weather_forecast rolling table.
--
-- This is an append-only provenance layer for the existing ingest response:
-- Standard Point fields are stored together with the explicitly labelled
-- Optimized Point probability overlay. It is not a pure OPF record.

CREATE TABLE IF NOT EXISTS public.weather_forecast_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_provider text NOT NULL DEFAULT 'spire',
  source_product text NOT NULL,
  source_composition jsonb NOT NULL,
  source_version text NOT NULL,
  location_id text NOT NULL,
  request_latitude double precision,
  request_longitude double precision,
  retrieved_at_utc timestamptz NOT NULL,
  issuance_time_utc timestamptz NOT NULL,
  issuance_time_source text NOT NULL DEFAULT 'spire'
    CHECK (issuance_time_source IN ('spire', 'retrieval_fallback')),
  valid_time_utc timestamptz NOT NULL,
  forecast_lead_hours double precision NOT NULL,

  air_temperature_c double precision,
  wind_speed_ms double precision,
  wind_direction_deg double precision,
  wind_gust_ms double precision,
  total_cloud_cover double precision,
  low_cloud_cover double precision,
  mid_cloud_cover double precision,
  high_cloud_cover double precision,
  ceiling_m double precision,
  cape double precision,
  lifted_index double precision,
  pwat double precision,
  dcape double precision,
  cin double precision,
  probability_of_precipitation_1hr double precision,
  probability_of_precipitation_24hr double precision,
  probability_of_thunderstorm double precision,
  probability_of_fog double precision,
  precipitation_rate double precision,
  relative_humidity double precision,
  values_json jsonb NOT NULL,

  opf_overlay_applied boolean NOT NULL DEFAULT false,
  snapshot_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT weather_forecast_snapshot_identity_key
    UNIQUE (location_id, valid_time_utc, issuance_time_utc),
  CONSTRAINT weather_forecast_snapshot_hash_key UNIQUE (snapshot_hash)
);

-- Query path for lead-time curves. The identity constraint dedupes a known
-- issuance; the hash also protects exact replay of a response.
CREATE INDEX IF NOT EXISTS weather_forecast_snapshot_location_valid_idx
  ON public.weather_forecast_snapshot (location_id, valid_time_utc);

CREATE INDEX IF NOT EXISTS weather_forecast_snapshot_issuance_idx
  ON public.weather_forecast_snapshot (location_id, issuance_time_utc DESC);

CREATE INDEX IF NOT EXISTS weather_forecast_snapshot_lead_idx
  ON public.weather_forecast_snapshot (location_id, forecast_lead_hours);

ALTER TABLE public.weather_forecast_snapshot ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.weather_forecast_snapshot IS
  'Append-only Spire forecast issuance snapshots. Standard Point plus explicitly labelled OPF probability overlay; not pure OPF.';
COMMENT ON COLUMN public.weather_forecast_snapshot.snapshot_hash IS
  'Deterministic content hash used to make replaying the same hourly response idempotent.';
COMMENT ON COLUMN public.weather_forecast_snapshot.issuance_time_source IS
  'spire when supplied by the response; retrieval_fallback only when issuance metadata is absent.';
