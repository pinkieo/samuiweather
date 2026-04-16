import type { SamuiWeatherForecastRow } from './spire';
import { formatTempC, formatWindKts } from './spire';

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function bangkokDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function bangkokTodayKey(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** Representative hourly row for “tomorrow” (ICT): prefer ~12:00 Bangkok, else first hour of that calendar day. */
export function getTomorrowForecastRow(
  rows: SamuiWeatherForecastRow[],
): SamuiWeatherForecastRow | null {
  if (rows.length === 0) return null;
  const today = bangkokTodayKey();
  const dates = [...new Set(rows.map((r) => bangkokDateKey(r.time)))]
    .filter((s) => s >= today)
    .sort();
  const target = dates.find((s) => s > today) ?? null;
  if (!target) return null;

  const tomorrowRows = rows.filter((r) => bangkokDateKey(r.time) === target);
  if (tomorrowRows.length === 0) return null;

  let best = tomorrowRows[0]!;
  let bestDist = 99;
  for (const r of tomorrowRows) {
    const hour = parseInt(
      new Date(r.time).toLocaleTimeString('en-US', {
        hour: '2-digit',
        hour12: false,
        timeZone: 'Asia/Bangkok',
      }),
      10,
    );
    const dist = Math.abs(hour - 12);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return best;
}

export function formatTomorrowOneLiner(row: SamuiWeatherForecastRow): string {
  const wd = DIRS[Math.round((row.windDir ?? 0) / 22.5) % 16];
  const rain =
    row.precipRate > 0.05
      ? `rain to ${row.precipRate.toFixed(1)} mm/h`
      : 'dry window likely';
  return `${formatTempC(row.temp)}°C · ${wd} ${formatWindKts(row.windSpeed)} kts · ${rain}`;
}

/** One tip per calendar day (stable for the day, varied across the month). */
export const SAMUI_DAILY_TIPS: string[] = [
  'Songthaews run ring routes — flag one down and confirm “Chaweng” or your beach before you hop in.',
  '7-Eleven ATMs are everywhere; carry some cash for small beach bars and market stalls.',
  'If Na Muang waterfall is busy, start early — the pool is quieter before 10:00.',
  'Lamai viewpoint and Lad Koh are easy sunset stops; park mindfully on the narrow road.',
  'Snorkel trips to Koh Tao often leave from Mae Nam / Bang Rak — book wind-aware days.',
  'Big Buddha road is steep; scooters: check brakes before the climb.',
  'Central Samui and Chaweng have proper pharmacies — sunscreen and electrolytes in stock.',
  'Full moon and holiday weekends: book Chaweng restaurants if you want a specific spot.',
  'Ang Thong is a full day — take seasickness tabs if the Gulf is choppy.',
  'Fish sauce and chili are defaults; say “mai pet” for less heat.',
  'Rain squalls are often short — radar + a café backup beats guessing from the hotel balcony.',
  'Airport taxis are fixed-price counters — screenshot your hotel Thai name for the desk.',
  'Lipa Noi ferries to Donsak: arrive 45 min early on peak days.',
  'Wat Khunaram is respectful dress — shoulders covered, quiet around the mummified monk site.',
];

/** Stable tip for the current Bangkok calendar day. */
export function pickDailySamuiTip(): string {
  const key = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  let s = 0;
  for (let i = 0; i < key.length; i++) s += key.charCodeAt(i);
  return SAMUI_DAILY_TIPS[s % SAMUI_DAILY_TIPS.length]!;
}
