/**
 * Internal second-model snapshot for **only** the first hour of the strip.
 * Today: from the server route that fetches the Meteoblue package — **not** ground truth;
 * used for a short “now” nudge and future comparison / ML features next to Spire + OPF.
 * Ecowitt (when fresh) overrides this for Samui row 0 — real outdoor readings at Baan Ton Kluay.
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

/**
 * Baan Ton Kluay ground truth on row 0 when the station checked in recently.
 * Overrides Meteoblue/Spire for outdoor temp, wind, rain rate, and UV at the pin.
 */
export function blendEcowittIntoFirstRow(
  rows: SamuiWeatherForecastRow[],
  snap: EcowittGroundSnapshot | null,
): SamuiWeatherForecastRow[] {
  if (!snap || rows.length === 0) return rows;
  if (observationAgeMinutes(snap.observedAt) > ECOWITT_STALE_MINUTES) return rows;

  const r0 = { ...rows[0] };
  if (snap.tempC != null && Number.isFinite(snap.tempC)) {
    r0.temp = snap.tempC;
    r0.feelsLike = snap.tempC;
  }
  if (snap.windSpeedMs != null && Number.isFinite(snap.windSpeedMs)) {
    r0.windSpeed = snap.windSpeedMs;
  }
  if (snap.windDirDeg != null && Number.isFinite(snap.windDirDeg)) {
    r0.windDir = snap.windDirDeg;
  }
  if (snap.rainRateMmh != null && Number.isFinite(snap.rainRateMmh)) {
    r0.precipRate = Math.max(0, snap.rainRateMmh);
    if (snap.rainRateMmh > 0.05) {
      r0.pop = Math.max(r0.pop, Math.min(92, Math.round(40 + snap.rainRateMmh * 30)));
    }
  }
  if (snap.uvIndex != null && Number.isFinite(snap.uvIndex)) {
    r0.uvIndex = snap.uvIndex;
  }
  if (snap.humidityPct != null && Number.isFinite(snap.humidityPct)) {
    r0.humidity = snap.humidityPct;
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
