#!/usr/bin/env npx tsx
/**
 * CLI: upsert latest posts into `reddit_samui_posts`.
 *
 *   npx tsx scripts/reddit-samui-fetch.ts
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { fetchDailySamuiTopics } from '../lib/reddit-fetcher';

config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const r = await fetchDailySamuiTopics();
  if (r.error) {
    console.error('Error:', r.error);
    process.exit(1);
  }
  console.log(`Done. Upserted ${r.count} rows from: ${r.subreddits.join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
