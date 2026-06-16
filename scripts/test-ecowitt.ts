/**
 * One-shot Ecowitt pipeline test: HTTP ingest → /api/ecowitt/latest.
 * Usage: npx tsx scripts/test-ecowitt.ts [baseUrl]
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

const base = process.argv[2]?.replace(/\/$/, '') ?? 'http://localhost:3000';
const secret = process.env.ECOWITT_INGEST_SECRET?.trim();

if (!secret) {
  console.error('ECOWITT_INGEST_SECRET missing in .env.local');
  process.exit(1);
}

const now = new Date();
const dateutc = now.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

const ingestParams = new URLSearchParams({
  secret,
  stationtype: 'test-script',
  tempf: '86.2',
  humidity: '74',
  windspeedmph: '5.1',
  windgustmph: '8.3',
  winddir: '195',
  rainratein: '0.02',
  hourlyrainin: '0.04',
  dailyrainin: '0.18',
  uv: '7',
  solarradiation: '612',
  baromrelin: '29.92',
  dateutc,
});

async function main() {
  const ingestUrl = `${base}/api/ecowitt/ingest?${ingestParams}`;
  console.log('POST ingest →', `${base}/api/ecowitt/ingest?secret=…&dateutc=${encodeURIComponent(dateutc)}`);

  const ingestRes = await fetch(ingestUrl, { method: 'GET', cache: 'no-store' });
  const ingestBody = await ingestRes.json().catch(() => ({}));
  console.log('Ingest status:', ingestRes.status);
  console.log('Ingest body:', JSON.stringify(ingestBody, null, 2));

  if (ingestRes.status === 401) {
    console.error('\n401 Unauthorized — restart `npm run dev` so Next.js picks up ECOWITT_INGEST_SECRET.');
    process.exit(1);
  }

  const latestRes = await fetch(`${base}/api/ecowitt/latest`, { cache: 'no-store' });
  const latestBody = await latestRes.json().catch(() => ({}));
  console.log('\nLatest status:', latestRes.status);
  console.log('Latest body:', JSON.stringify(latestBody, null, 2));

  if (!latestBody?.observation) {
    process.exit(1);
  }

  const o = latestBody.observation;
  console.log('\n✓ Ground station readings:');
  console.log(`  Time:     ${o.observedAt}`);
  console.log(`  Temp:     ${o.temperatureC} °C`);
  console.log(`  Humidity: ${o.humidityPct}%`);
  console.log(`  Rain:     ${o.rainRateMmh} mm/h (today ${o.rainDayMm} mm)`);
  console.log(`  Wind:     ${o.windSpeedMs} m/s @ ${o.windDirectionDeg}°`);
  console.log(`  UV:       ${o.uvIndex}`);
  console.log(`  Solar:    ${o.solarWm2} W/m²`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
