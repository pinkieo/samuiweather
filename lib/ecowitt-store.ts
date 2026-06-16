import { createClient } from '@supabase/supabase-js';
import { buildEcowittDbRow, type EcowittPayload } from './ecowitt-payload';

export type UpsertEcowittResult =
  | { ok: true; id: string; observedAt: string }
  | { ok: false; error: string };

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Insert or update one observation (unique on location_id + observed_at). */
export async function upsertEcowittObservation(
  payload: EcowittPayload,
): Promise<UpsertEcowittResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' };
  }

  const row = buildEcowittDbRow(payload);
  const { data, error } = await supabase
    .from('ecowitt_observations')
    .upsert(row, { onConflict: 'location_id,observed_at' })
    .select('id,observed_at')
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data?.id || !data?.observed_at) {
    return { ok: false, error: 'Upsert returned no row' };
  }

  return { ok: true, id: data.id, observedAt: data.observed_at };
}
