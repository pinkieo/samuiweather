/** Probe + score Spire vs Ecowitt for every ICT day in the overlap. */
import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import { getSupabaseAdmin } from '../lib/supabase-admin';
import { ECOWITT_LOCATION_ID, ictYmd } from '../lib/ecowitt-data';
import { SPIRE_LOCATION_ID } from '../lib/forecast-day-accuracy';
import { scoreForecastTrend } from '../lib/forecast-accuracy-trend';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

async function bounds() {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error('no supabase');
  const ecoFirst = await sb
    .from('ecowitt_observations')
    .select('observed_at')
    .eq('location_id', ECOWITT_LOCATION_ID)
    .order('observed_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const ecoLast = await sb
    .from('ecowitt_observations')
    .select('observed_at')
    .eq('location_id', ECOWITT_LOCATION_ID)
    .order('observed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const histFirst = await sb
    .from('weather_history')
    .select('valid_time_utc')
    .eq('location_id', SPIRE_LOCATION_ID)
    .order('valid_time_utc', { ascending: true })
    .limit(1)
    .maybeSingle();
  const histLast = await sb
    .from('weather_history')
    .select('valid_time_utc')
    .eq('location_id', SPIRE_LOCATION_ID)
    .order('valid_time_utc', { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    ecoFirst: ecoFirst.data?.observed_at,
    ecoLast: ecoLast.data?.observed_at,
    histFirst: histFirst.data?.valid_time_utc,
    histLast: histLast.data?.valid_time_utc,
  };
}

async function main() {
  const b = await bounds();
  console.error(JSON.stringify(b, null, 2));
  const from = process.argv[2] || (b.ecoFirst ? ictYmd(new Date(b.ecoFirst)) : '2026-06-01');
  const to = process.argv[3] || ictYmd(new Date(Date.now() - 24 * 3600 * 1000));
  const trend = await scoreForecastTrend(from, to);
  if (!trend.ok) {
    console.error(trend.error);
    process.exit(1);
  }
  const out = resolve(process.cwd(), 'broadcast-out', 'forecast-accuracy-trend.json');
  writeFileSync(out, JSON.stringify(trend, null, 2));
  console.log(JSON.stringify({ ...trend, days: undefined, dayCount: trend.days.length, wrote: out }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
