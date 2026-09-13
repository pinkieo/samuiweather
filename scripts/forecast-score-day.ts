/** Score Spire vs Ecowitt for one ICT day. Usage: npx tsx scripts/forecast-score-day.ts [YYYY-MM-DD] */
import { config } from 'dotenv';
import { resolve } from 'path';
import { fetchEcowittDaily, parseIctDateYmd, yesterdayIctDate } from '../lib/ecowitt-data';
import {
  bucketStationHours,
  fetchSpireHoursForIctDay,
  scoreForecastDay,
} from '../lib/forecast-day-accuracy';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

const date = parseIctDateYmd(process.argv[2]) ?? yesterdayIctDate();

async function main() {
  const [station, forecast] = await Promise.all([
    fetchEcowittDaily(date),
    fetchSpireHoursForIctDay(date),
  ]);
  if (!station.ok) {
    console.error(station.error);
    process.exit(1);
  }
  if (!forecast.ok) {
    console.error(forecast.error);
    process.exit(1);
  }
  const score = station.summary.available
    ? scoreForecastDay(station.summary, bucketStationHours(station.samples), forecast.hours)
    : null;
  console.log(
    JSON.stringify(
      {
        date,
        station: station.summary,
        forecastHours: forecast.hours.length,
        score,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
