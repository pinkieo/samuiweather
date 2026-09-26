/**
 * Station and private now-cast snapshots.
 * They feed the Now block only. They must not be copied onto a Spire forecast hour:
 * a dry station reading used to sit next to a rain chance that the now-cast had raised.
 */
import type { SamuiWeatherForecastRow } from './spire';

export interface ReferenceNowcastSnapshot {
  tempC: number | null;
  windSpeedMs: number;
  windDirDeg: number;
  /** Nearest 1h slot, mm in that window — used as mm/h-like intensity. */
  precipMm: number;
}

/** Live Ecowitt outdoor snapshot — highest priority for Samui “now” when fresh. */
export interface EcowittGroundSnapshot {
  observedAt: string;
  tempC: number | null;
  humidityPct: number | null;
  windSpeedMs: number | null;
  windDirDeg: number | null;
  rainRateMmh: number | null;
  uvIndex: number | null;
}

const ECOWITT_STALE_MINUTES = 20;

function observationAgeMinutes(observedAt: string): number {
  const t = new Date(observedAt).getTime();
  if (Number.isNaN(t)) return Infinity;
  return Math.round((Date.now() - t) / 60_000);
}

/**
 * Forecast hours stay Spire. The private now-cast is not a rain chance.
 * Kept so older callers cannot raise `pop` on row 0.
 */
export function blendReferenceNowcastIntoFirstRow(
  rows: SamuiWeatherForecastRow[],
  _snap: ReferenceNowcastSnapshot | null,
): SamuiWeatherForecastRow[] {
  return rows;
}

/** Fresh enough to show as “Now” on the home page. */
export function ecowittReadingIsFresh(observedAt: string): boolean {
  return observationAgeMinutes(observedAt) <= ECOWITT_STALE_MINUTES;
}

/**
 * Forecast hours stay Spire. The station is shown in the Now block, not painted onto row 0.
 * Kept so older callers cannot leave a raised rain chance next to a dry station reading.
 */
export function blendEcowittIntoFirstRow(
  rows: SamuiWeatherForecastRow[],
  _snap: EcowittGroundSnapshot | null,
): SamuiWeatherForecastRow[] {
  return rows;
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
