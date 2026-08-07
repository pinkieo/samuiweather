# Samui Ecowitt source — forecast provenance note

The authoritative observation source remains the existing Ecowitt pipeline:

```text
Ecowitt Cloud → /api/cron/ecowitt-sync → Supabase ecowitt_observations
```

The Spire forecast source used for future validation is persisted by the
existing hourly job in two layers:

- `weather_forecast`: current operational forecast, still upserted by
  `(location_id, valid_time_utc)`;
- `weather_forecast_snapshot`: every post-migration hourly issuance, deduped by
  deterministic `snapshot_hash`.

Before `021_weather_forecast_snapshots.sql`, only the latest issuance per valid
time was retained. Existing `weather_history` data is not deleted or rebuilt,
but it cannot provide a complete pre-migration issuance ladder.

The snapshot is explicitly a hybrid record: Standard Point forecast fields
plus Optimized Point probability overlay fields. It stores UTC
`issuance_time_utc`, `valid_time_utc`, `retrieved_at_utc`,
`forecast_lead_hours`, normalized columns, full `values_json`, request
coordinates, source composition, and source version.

No second Ecowitt reader, forecast API call, or historical forecast backfill is
introduced. See `SAMUI_FORECAST_PROVENANCE.md` for the persistence contract.
