#!/usr/bin/env npx tsx
/**
 * CLI: AI-pick daily topic + Sammi Q&A (writes to reddit_samui_posts).
 *
 *   npx tsx scripts/daily-sammi-topic-cli.ts
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 * Optional: SPIRE_API_TOKEN (for richer weather — otherwise forecast step may fail silently)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { generateDailySammiTopic } from '../lib/daily-sammi-topic';
import { getSamuiForecastMerged } from '../lib/spire';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  let rows = null;
  try {
    rows = await getSamuiForecastMerged();
  } catch {
    /* SPIRE optional for local dry-run */
  }
  const r = await generateDailySammiTopic({ forecastRows: rows ?? undefined });
  if (!r.ok) {
    console.error('Failed:', r.error);
    process.exit(1);
  }
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
