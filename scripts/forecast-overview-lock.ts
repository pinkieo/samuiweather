/** Lock current/previous ICT overview slots. Used after hourly Spire ingest. */
import { config } from 'dotenv';
import { resolve } from 'path';
import { lockDueSlots } from '../lib/forecast-overview';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const locks = await lockDueSlots();
  console.log(JSON.stringify({ ok: true, locks }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
