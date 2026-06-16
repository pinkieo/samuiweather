import type { SamuiWeatherForecastRow } from './spire';
import { rainChancePercentForRow } from './sammi-views';

const SIX_H_MS = 6 * 60 * 60 * 1000;
/** Include the current model step if it started slightly before “now”. */
const START_SLACK_MS = 15 * 60 * 1000;

/**
 * True if live radar at the pin shows echo, or if Spire/Sammi merged hourly data
 * suggests rain in the next 6 hours (rate, POP, or merged rain chance).
 */
export function rainPossibleInNext6Hours(
  rows: SamuiWeatherForecastRow[],
  radarEcho: 'unknown' | 'none' | 'precip',
  nowMs: number = Date.now(),
): boolean {
  if (radarEcho === 'precip') return true;

  const start = nowMs - START_SLACK_MS;
  const end = nowMs + SIX_H_MS;

  for (const row of rows) {
    const t = new Date(row.time).getTime();
    if (!Number.isFinite(t) || t < start || t > end) continue;

    if ((row.precipRate ?? 0) >= 0.08) return true;
    if ((row.pop ?? 0) >= 30) return true;
    if (rainChancePercentForRow(row) >= 40) return true;
  }

  return false;
}
