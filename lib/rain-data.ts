/**
 * Persist numeric rain / convective features for ML (Supervised learning on labels
 * filled later from stations, verification grids, or manual QC).
 *
 * Does **not** store radar imagery — only scalars suitable for tabular models
 * (regenvensters, stormrichting, “raakt het strand?”). Labels are intentionally
 * nullable until a backfill job links ground truth. Planned cadence: one row every
 * ~10–15 minutes per location via cron or Supabase Edge Function.
 *
 * Call only from server contexts with `SUPABASE_SERVICE_ROLE_KEY` (RLS has no
 * public insert policy).
 */

import { createClient } from '@supabase/supabase-js';
import type { RainObservation } from '@/types/supabase';

type InsertPayload = Record<string, string | number | boolean | null>;

function toRow(data: Partial<RainObservation>): InsertPayload {
  const row: InsertPayload = {};
  if (data.observedAt != null) row.observed_at = data.observedAt;
  if (data.location != null) row.location = data.location;
  if (data.rainviewerTimestamp !== undefined) {
    row.rainviewer_timestamp = data.rainviewerTimestamp;
  }
  if (data.rainRateMmh !== undefined) row.rain_rate_mmh = data.rainRateMmh;
  if (data.windSpeedKmh !== undefined) row.wind_speed_kmh = data.windSpeedKmh;
  if (data.windDirectionDeg !== undefined) {
    row.wind_direction_deg = data.windDirectionDeg;
  }
  if (data.spireCape !== undefined) row.spire_cape = data.spireCape;
  if (data.spirePwat !== undefined) row.spire_pwat = data.spirePwat;
  if (data.spireCin !== undefined) row.spire_cin = data.spireCin;
  if (data.spireDcape !== undefined) row.spire_dcape = data.spireDcape;
  if (data.spireThunderstormProb !== undefined) {
    row.spire_thunderstorm_prob = data.spireThunderstormProb;
  }
  if (data.labelRainIn30Min !== undefined) {
    row.label_rain_in_30min = data.labelRainIn30Min;
  }
  if (data.labelRainIn60Min !== undefined) {
    row.label_rain_in_60min = data.labelRainIn60Min;
  }
  if (data.labelRainIn90Min !== undefined) {
    row.label_rain_in_90min = data.labelRainIn90Min;
  }
  if (data.labelHeavyRain !== undefined) {
    row.label_heavy_rain = data.labelHeavyRain;
  }
  if (data.labelStormHitsCoast !== undefined) {
    row.label_storm_hits_coast = data.labelStormHitsCoast;
  }
  return row;
}

export type SaveRainObservationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Insert one observation. Requires `observedAt` (ISO UTC) and `location`.
 * Other fields optional; omitted keys are left DB-default / NULL.
 */
export async function saveRainObservation(
  data: Partial<RainObservation> & Pick<RainObservation, 'observedAt' | 'location'>,
): Promise<SaveRainObservationResult> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' };
  }

  const row = toRow(data);
  if (row.observed_at == null || row.location == null) {
    return { ok: false, error: 'observedAt and location are required' };
  }

  const supabase = createClient(url, key);
  const { data: inserted, error } = await supabase
    .from('rain_observations')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  const id = inserted?.id;
  if (typeof id !== 'string') {
    return { ok: false, error: 'Insert returned no id' };
  }
  return { ok: true, id };
}
