# Samui forecast provenance

Status: REFERENCE
Document version: 1.0
Last updated: 2026-09-01
Last verified: NOT VERIFIED
Owner: ProSeadure

Status: implemented on the hourly ingest path. Migration activated on
**2026-08-07**. No new Spire request type was added.

## Persistence model

Before migration `021_weather_forecast_snapshots.sql`, Samui retained only the
latest issuance for each `location_id + valid_time_utc` in
`weather_forecast`. Expired rows were moved to `weather_history`, but that
table still contained only the row present when the valid time expired. The
pre-migration history therefore does not contain a complete issuance ladder and
is not reconstructed.

From migration activation onward:

- `weather_forecast` remains the rolling/current operational table and keeps
  its existing `(location_id, valid_time_utc)` upsert behavior.
- `weather_forecast_snapshot` receives one row for every row in the already
  fetched hourly merged response.
- Replaying the same response is idempotent through `snapshot_hash`.
- `weather_history` and `forecast_verification` are unchanged.

## Snapshot provenance

Each snapshot stores:

- `source_provider = spire`;
- `source_product =
  standard_point_plus_optimized_point_probability_overlay`;
- source composition JSON identifying Standard Point and Optimized Point;
- request latitude/longitude;
- retrieval, issuance, and valid timestamps in UTC;
- deterministic `forecast_lead_hours = valid - issuance`;
- normalized forecast columns;
- complete `values_json`;
- `opf_overlay_applied`;
- `source_version` and `snapshot_hash`.

The record is explicitly hybrid. It must not be described as a pure Optimized
Point forecast: Standard Point supplies the forecast row and Optimized Point
supplies matching probability fields when available.

If Spire omits `issuance_time`, the snapshot uses retrieval time as a clearly
marked `issuance_time_source = retrieval_fallback`. This is safe for storage
and deduplication, but those rows should not be treated as precise lead-time
evidence.

## Table and indexes

Migration: `supabase/021_weather_forecast_snapshots.sql`

`weather_forecast_snapshot` has a UUID primary key and a unique deterministic
`snapshot_hash`. It also indexes `(location_id, valid_time_utc)`,
`(location_id, issuance_time_utc DESC)`, and lead hours. The hash prevents
duplicates when the same issuance/response is ingested repeatedly, while the
existing current table remains untouched.

RLS is enabled with the same server-side posture as the existing weather
tables. The hourly job uses the existing `SUPABASE_SERVICE_ROLE_KEY` /
`SUPABASE_KEY` configuration.

## Volume estimate

The current `weather_forecast` table contains **113 rows** for
`samui_opf_hybrid` (read-only measurement before migration 021). The ingest
then iterates over every row in `merged` and appends one `snapshot_rows` entry
per row before the current-table upsert. Therefore 113 is the current response
row count, not merely the number of rows that change: under the normal hourly
response shape, **113 snapshots are submitted on every hourly cycle**. The
actual count can vary if Spire returns a different merged horizon or a fallback
tier changes the row set.

At one run per hour:

- **113 rows/run**
- **2,712 rows/day** (`113 × 24`)
- **81,360 rows/30 days** (`2,712 × 30`)
- **989,880 rows/year** (`2,712 × 365`)

### Measured payload sizes

No Spire request was made. A read-only sample of all 113 current rows measured:

| Measurement | Result |
|---|---:|
| `values_json` serialized size | 1,058–1,295 bytes; **1,165 B average** |
| Existing full current-row JSON | 1,855–2,085 bytes; **1,959 B average** |
| Estimated snapshot logical JSON | 2,530–2,760 bytes; **2,634 B average** |
| Snapshot source-composition JSON | **504 B** |

The snapshot logical estimate includes the measured forecast payload plus the
new provenance fields, normalized values, timestamps, hash, and source
composition. It is not a PostgreSQL `pg_column_size()` measurement because the
migration has intentionally not been applied.

### Storage estimate before migration

| Component | Estimate per row | 30 days | 1 year |
|---|---:|---:|---:|
| Logical JSON payload | 2.63 KiB | 204 MiB | 2.43 GiB |
| Heap row, including PostgreSQL tuple/column overhead | 3.0–3.6 KiB | 238–286 MiB | 2.83–3.40 GiB |
| Six B-tree indexes (PK, two unique, three query indexes) | 1.0–1.9 KiB | 79–151 MiB | 0.93–1.77 GiB |
| **Estimated total heap + indexes** | **4.0–5.5 KiB** | **318–437 MiB** | **3.78–5.19 GiB** |

The heap and index ranges are planning estimates around the measured 2,634 B
logical snapshot payload; PostgreSQL version, fillfactor, page alignment,
TOAST behavior, and index bloat can move the actual result. After activation,
`pg_total_relation_size('public.weather_forecast_snapshot')` should be used
for the authoritative measurement.

### Initial storage baseline after activation

The capacity baseline was confirmed manually from the Samui Supabase project
dashboard before activation:

```text
Baseline date: 2026-08-07
Provisioned disk: 8 GB
Total disk usage before snapshot activation: ~1.03 GB
Database size before snapshot activation: ~0.15 GB
```

After one controlled hourly ingest:

```text
Snapshot table initial heap size: 237,568 bytes
Snapshot table initial index size: 122,880 bytes
Snapshot table initial total size: 393,216 bytes
Snapshot row count: 113
Measured total bytes per snapshot row: 3,479.8 bytes (3.40 KiB)
Measured heap bytes per row: 2,102.4 bytes
Measured index bytes per row: 1,087.4 bytes
```

This first sample is too small to establish a stable long-term growth rate:
PostgreSQL relation and index pages have fixed allocation effects. Using the
initial total as a simple planning baseline gives approximately **270 MiB per
30 days** and **3.21 GiB per year**, while the previous conservative
**318–437 MiB/month** and **3.78–5.19 GiB/year** range remains the capacity
planning guardrail until a larger sample exists.

### Storage monitoring policy

No retention, compression, or archive policy is active. All hourly forecast
slots are intentionally preserved, including unchanged forecasts.

Check around **2026-09-07**:

- Supabase total disk usage and database size;
- `pg_total_relation_size('public.weather_forecast_snapshot')`;
- snapshot row count;
- average daily row and byte growth;
- `weather_history` and other large-table growth.

Repeat around **2026-11-07**. At three months, reassess runway and whether
disk expansion, partitioning, or eventual archive storage is needed. Do not
delete or archive automatically.

Initial thresholds against the 8 GB provisioned disk:

- **Green:** below 60%; no action;
- **Review:** 60% or higher; review monthly growth and runway;
- **Action required:** 75% or higher; prepare a capacity decision before
  continuing uncontrolled growth.

## Test coverage

`tests/test_weather_forecast_snapshots.py` verifies:

1. UTC lead-time calculation;
2. different issuances produce different snapshot hashes;
3. missing issuance metadata is explicitly marked as a retrieval fallback.

The ingest still performs exactly the existing Standard Point and parallel
Optimized Point calls. Snapshot persistence consumes the merged response and
does not call Spire.
