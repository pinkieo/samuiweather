#!/usr/bin/env npx tsx
/**
 * Print a Sammi Broadcast script JSON from live Spire hours.
 *
 *   npm run broadcast:script
 *   npx tsx scripts/broadcast-script.ts --slot 7
 *   npx tsx scripts/broadcast-script.ts --hourly
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import {
  buildBroadcastScriptFromRows,
  featureSlotForHour,
  isFeatureIctHour,
  localIctHour,
  type BroadcastSlot,
  type FeatureIctHour,
} from '../lib/broadcast-script';
import { getSamuiForecastMerged } from '../lib/spire';

function parseSlot(): BroadcastSlot {
  const hourly = process.argv.includes('--hourly');
  if (hourly) return 'hourly';
  const idx = process.argv.indexOf('--slot');
  if (idx !== -1) {
    const raw = Number(process.argv[idx + 1]);
    if (isFeatureIctHour(raw)) return featureSlotForHour(raw as FeatureIctHour);
    if (process.argv[idx + 1] === 'hourly') return 'hourly';
    throw new Error('--slot must be 7, 11, 15, 19, or hourly');
  }
  const hour = localIctHour();
  return isFeatureIctHour(hour) ? featureSlotForHour(hour) : 'hourly';
}

async function main() {
  const slot = parseSlot();
  const rows = await getSamuiForecastMerged();
  if (rows.length === 0) {
    console.error('No SPIRE data. Check SPIRE_API_TOKEN.');
    process.exit(1);
  }
  const script = buildBroadcastScriptFromRows(rows, { slot });
  console.log(JSON.stringify(script, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
