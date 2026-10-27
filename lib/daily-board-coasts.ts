/**
 * Coast rain-rate helpers. `/board/today` does not draw shore maps and
 * does not call `loadCoastRainRates`. Nothing here is written back to
 * `weather_forecast` or `weather_history`. A missing `precipitation_rate`
 * stays null.
 */

import type { BoardRegionId, CoastRateHour } from '@/lib/daily-board';
import { COAST_ANCHORS } from '@/lib/daily-board-map';
import { buildForecastPointUrl, getSpireApiToken } from '@/lib/spire';

const REGION_IDS = Object.keys(COAST_ANCHORS) as BoardRegionId[];

/** How far ahead to ask Spire. Null when the ICT day has already ended. */
export function coastForecastHours(dayEndUtc: Date, now: Date): number | null {
  const aheadMs = dayEndUtc.getTime() - now.getTime();
  if (aheadMs <= 0) return null;
  const aheadHours = Math.ceil(aheadMs / 3_600_000) + 6;
  return Math.min(72, Math.max(36, aheadHours));
}

function rateFromValues(values: unknown): number | null {
  if (!values || typeof values !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(values, 'precipitation_rate')) return null;
  const raw = (values as { precipitation_rate?: unknown }).precipitation_rate;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return raw;
}

function rowsFromPayload(region: BoardRegionId, payload: unknown): CoastRateHour[] {
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: CoastRateHour[] = [];
  for (const entry of data) {
    const timeUtc = (entry as { times?: { valid_time?: unknown } }).times?.valid_time;
    if (typeof timeUtc !== 'string' || !timeUtc) continue;
    const values = (entry as { values?: unknown }).values;
    out.push({ region, timeUtc, rateMmHr: rateFromValues(values) });
  }
  return out;
}

async function fetchCoast(
  region: BoardRegionId,
  token: string,
  forecastHours: number,
): Promise<CoastRateHour[]> {
  const anchor = COAST_ANCHORS[region];
  const url = buildForecastPointUrl(anchor.lat, anchor.lon, 'basic', {
    timeBundle: 'hourly',
    forecastHours,
  });
  const res = await fetch(url, {
    headers: { 'spire-api-key': token },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    console.error(`[daily-board] coast ${region} Spire status ${res.status}`);
    return [];
  }
  const json: unknown = await res.json().catch(() => null);
  return rowsFromPayload(region, json);
}

export async function loadCoastRainRates(
  dayEndUtc: Date,
  now: Date = new Date(),
): Promise<{ status: 'live'; rates: CoastRateHour[] } | { status: 'unread'; rates: CoastRateHour[] }> {
  const token = getSpireApiToken();
  const forecastHours = coastForecastHours(dayEndUtc, now);
  if (!token || forecastHours == null) return { status: 'unread', rates: [] };
  const groups = await Promise.all(
    REGION_IDS.map(async (region) => {
      try {
        return await fetchCoast(region, token, forecastHours);
      } catch (err) {
        console.error(
          `[daily-board] coast ${region} read failed`,
          err instanceof Error ? err.message : err,
        );
        return [];
      }
    }),
  );
  const rates = groups.flat();
  if (!rates.length) return { status: 'unread', rates: [] };
  return { status: 'live', rates };
}
