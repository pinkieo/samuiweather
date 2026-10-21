/**
 * Real check: shape today's board from production /api/weather and the
 * stored Supabase hours, then compare rain and UV on every shared hour.
 *
 *   SUPABASE_URL=... SUPABASE_KEY=... npx tsx scripts/verify-board-feed.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { boardHourFromForecastRow, loadDailyBoard } from '../lib/daily-board-load';
import { newestIssuanceTimeUtc, type SamuiWeatherForecastRow } from '../lib/spire';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

const WEATHER = 'https://www.samuiweather.com/api/weather';
const DEBUG = 'https://www.samuiweather.com/api/spire/forecast-debug';

function ictParts(iso: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

async function main() {
  const [weatherRes, debugRes] = await Promise.all([fetch(WEATHER), fetch(DEBUG)]);
  if (!weatherRes.ok) throw new Error(`weather ${weatherRes.status}`);
  if (!debugRes.ok) throw new Error(`debug ${debugRes.status}`);
  const weather = (await weatherRes.json()) as {
    freshness?: { issued_at?: string; source?: string };
    forecast?: SamuiWeatherForecastRow[];
  };
  const debug = (await debugRes.json()) as {
    queries?: { ok?: boolean; data?: unknown[] }[];
  };
  const forecast = weather.forecast ?? [];
  if (!forecast.length) throw new Error('production /api/weather returned no hours');
  const issuance = newestIssuanceTimeUtc(
    (debug.queries ?? []).flatMap((query) => (query.ok && Array.isArray(query.data) ? query.data : [])),
  );
  if (!issuance) throw new Error('Spire debug payload had no issuance_time');

  const liveHours = forecast.map(boardHourFromForecastRow);
  const now = new Date();
  const board = await loadDailyBoard({
    now,
    loadFeed: async () => ({ hours: liveHours, issuedAtUtc: issuance }),
  });
  const stored = await loadDailyBoard({
    now,
    loadFeed: async () => null,
  });

  const byHour = new Map(board.hours.filter((h) => h.present).map((h) => [h.ictHour, h]));
  const mismatches: string[] = [];
  const todayHours: { ict: string; feedRain: string; boardRain: string; feedUv: number | null; boardUv: string }[] = [];
  let compared = 0;
  for (const row of forecast) {
    const ict = ictParts(row.time);
    if (ict.date !== board.dateYmd || ict.hour < 6 || ict.hour > 21) continue;
    const shown = byHour.get(ict.hour);
    if (!shown) {
      mismatches.push(`${ict.date} ${ict.hour}:00 missing on the board`);
      continue;
    }
    compared += 1;
    const rain = row.pop == null ? '—' : `${Math.round(row.pop)}%`;
    if (shown.rainLabel !== rain) mismatches.push(`${ict.hour}:00 rain board ${shown.rainLabel} feed ${rain}`);
    const uv = row.uvIndex == null ? null : String(Math.round(row.uvIndex));
    if (uv != null && !shown.uvLabel.startsWith(`${uv} `) && shown.uvLabel !== uv) {
      mismatches.push(`${ict.hour}:00 uv board "${shown.uvLabel}" feed ${row.uvIndex}`);
    }
    todayHours.push({
      ict: `${ict.hour}:00`,
      feedRain: rain,
      boardRain: shown.rainLabel,
      feedUv: row.uvIndex,
      boardUv: shown.uvLabel,
    });
  }

  const report = {
    checked_at: now.toISOString(),
    feed_source: weather.freshness?.source ?? null,
    feed_header_issued_at: weather.freshness?.issued_at ?? null,
    spire_issuance_time_utc: issuance,
    live_board_issued: board.issuedLabel,
    stored_board_issued: stored.issuedLabel,
    stored_mode: stored.mode,
    live_mode: board.mode,
    board_date: board.dateYmd,
    hours_compared: compared,
    today: todayHours,
    mismatches,
  };
  console.log(JSON.stringify(report, null, 2));
  if (board.mode !== 'live') throw new Error('live board was not live');
  if (!board.issuedLabel?.includes('19:00') && issuance.startsWith('2026-10-20T12:00:00')) {
    throw new Error(`issued label ${board.issuedLabel} does not name the 12:00Z run`);
  }
  if (mismatches.length) throw new Error(`${mismatches.length} hour(s) differ from /api/weather`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
