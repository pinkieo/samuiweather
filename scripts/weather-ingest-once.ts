/** One Spire → Supabase ingest (same logic as /api/cron/weather-ingest). */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

import { runWeatherIngest } from '../lib/weather-ingest';

const force = process.argv.includes('--force');
runWeatherIngest({ force })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
