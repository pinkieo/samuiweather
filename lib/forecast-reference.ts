/**
 * Internal second-model snapshot for **only** the first hour of the strip.
 * Today: from the server route that fetches the Meteoblue package — **not** ground truth;
 * used for a short “now” nudge and future comparison / ML features next to Spire + OPF.
 * Observations (Ecowitt, METAR) remain the real validation.
 */
import type { SamuiWeatherForecastRow } from './spire';

export interface ReferenceNowcastSnapshot {
  tempC: number | null;
  windSpeedMs: number;
  windDirDeg: number;
  /** Nearest 1h slot, mm in that window — used as mm/h-like intensity. */
  precipMm: number;
}

/**
 * Apply the reference grid to row 0; hours 1..n stay unchanged Spire (+ Sammi DB if merged).
 */
export function blendReferenceNowcastIntoFirstRow(
  rows: SamuiWeatherForecastRow[],
  snap: ReferenceNowcastSnapshot | null,
): SamuiWeatherForecastRow[] {
  if (!snap || rows.length === 0) return rows;
  const r0 = { ...rows[0] };
  if (snap.tempC != null && Number.isFinite(snap.tempC)) {
    r0.temp = snap.tempC;
    r0.feelsLike = snap.tempC;
  }
  r0.windSpeed = snap.windSpeedMs;
  r0.windDir = snap.windDirDeg;
  r0.precipRate = Math.max(0, snap.precipMm);
  if (snap.precipMm > 0.08) {
    r0.pop = Math.max(r0.pop, Math.min(92, Math.round(45 + snap.precipMm * 25)));
  }
  return [r0, ...rows.slice(1)];
}

/** Compact JSON for `weather_validation.spire_snapshot` (cron / analytics). */
export function spireRowToValidationJson(row: SamuiWeatherForecastRow): Record<string, unknown> {
  return {
    time: row.time,
    temp: row.temp,
    feelsLike: row.feelsLike,
    pop: row.pop,
    precipRate: row.precipRate,
    windSpeed: row.windSpeed,
    windDir: row.windDir,
    cloudCover: row.cloudCover,
    uvIndex: row.uvIndex,
  };
}
