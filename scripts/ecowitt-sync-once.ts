/** Run one Ecowitt Cloud → Supabase sync (same logic as /api/cron/ecowitt-sync). */
import { config } from 'dotenv';
import { resolve } from 'path';
import { syncEcowittFromCloud } from '../lib/ecowitt-cloud';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

syncEcowittFromCloud()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
