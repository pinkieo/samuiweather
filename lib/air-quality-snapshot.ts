import type { SamuiWeatherForecastRow } from './spire';

/** 0 = good / no hit; 1 = moderate haze; 2 = poor; 3 = very poor (aligned with beach caps). */
export type AirQualitySeverity = 0 | 1 | 2 | 3;

/**
 * Severity tier for scoring and copy (WAQI on row 0: `aqi`, `pm25`).
 */
export function airQualitySeverity(row: SamuiWeatherForecastRow | null | undefined): AirQualitySeverity {
  if (!row) return 0;

  const aqi = row.aqi != null && Number.isFinite(Number(row.aqi)) ? Number(row.aqi) : null;
  const pm25 = row.pm25 != null && Number.isFinite(Number(row.pm25)) ? Number(row.pm25) : null;

  let s: AirQualitySeverity = 0;

  if (aqi != null) {
    if (aqi > 150) s = 3;
    else if (aqi > 100) s = 2;
    else if (aqi > 50) s = 1;
  }
  if (pm25 != null) {
    if (pm25 > 150) s = 3;
    else if (pm25 > 55) s = Math.max(s, 2) as AirQualitySeverity;
    else if (pm25 > 25) s = Math.max(s, 1) as AirQualitySeverity;
  }

  return s;
}

/**
 * Extra beach-score penalty when air is unhealthy (AQI &gt; 100 or PM2.5 &gt; 55). Returns 0 when mild.
 */
export function airQualityBeachPenalty(row: SamuiWeatherForecastRow | null | undefined): number {
  if (!row) return 0;
  const aqi = row.aqi != null && Number.isFinite(Number(row.aqi)) ? Number(row.aqi) : null;
  const pm25 = row.pm25 != null && Number.isFinite(Number(row.pm25)) ? Number(row.pm25) : null;

  let p = 0;
  if (aqi != null && aqi > 100) {
    if (aqi > 150) p = Math.max(p, 25);
    else p = Math.max(p, 15 + Math.min(10, Math.round((aqi - 100) / 5)));
  }
  if (pm25 != null && pm25 > 55) {
    if (pm25 > 120) p = Math.max(p, 25);
    else p = Math.max(p, 15 + Math.min(10, Math.round((pm25 - 55) / 10)));
  }
  return Math.min(25, p);
}

/** One short clause for beach advice (no trailing period — caller may join). */
export function airQualityBeachAdviceFragment(
  row: SamuiWeatherForecastRow | null | undefined,
): string | null {
  const sev = airQualitySeverity(row);
  if (sev === 0) return null;
  if (sev === 1) return 'Air’s a touch hazy — still fine for a dip';
  if (sev === 2) return 'Air quality’s iffy — shorter spells outside help';
  return 'Rough air today — favour indoor breaks';
}

export type AirQualitySnapshotHint = {
  /** Single friendly line for the Weather snapshot card */
  line: string;
  /** Tailwind text color class */
  textClass: string;
};

/**
 * Tourist-facing air line for the snapshot card. Only meaningful when WAQI merged on hour 0
 * (`row.pm25`, `row.aqi`). Returns null when air is in a “good” band — no clutter.
 *
 * Show when AQI > 50 or PM2.5 > 25 µg/m³ (either can trigger; both are considered for severity).
 */
export function getTouristAirQualityHint(
  row: SamuiWeatherForecastRow | null | undefined,
): AirQualitySnapshotHint | null {
  if (!row) return null;

  const aqiRaw = row.aqi;
  const pmRaw = row.pm25;
  const aqi = aqiRaw != null && Number.isFinite(Number(aqiRaw)) ? Number(aqiRaw) : null;
  const pm25 = pmRaw != null && Number.isFinite(Number(pmRaw)) ? Number(pmRaw) : null;

  const aqiElevated = aqi != null && aqi > 50;
  const pmElevated = pm25 != null && pm25 > 25;
  if (!aqiElevated && !pmElevated) return null;

  /** 1 = moderate, 2 = poor / sensitive, 3 = very poor */
  let severity = 1;

  if (aqiElevated) {
    if (aqi! <= 100) severity = Math.max(severity, 1);
    else if (aqi! <= 150) severity = Math.max(severity, 2);
    else severity = Math.max(severity, 3);
  }
  if (pmElevated) {
    if (pm25! <= 55) severity = Math.max(severity, 1);
    else if (pm25! <= 150) severity = Math.max(severity, 2);
    else severity = Math.max(severity, 3);
  }

  if (severity === 1) {
    return {
      line: 'Air quality: Moderate — a bit hazy, but still fine for the beach.',
      textClass: 'text-amber-200/90',
    };
  }
  if (severity === 2) {
    return {
      line: 'Air quality: Poor — sensitive groups should limit time outdoors.',
      textClass: 'text-orange-200/90',
    };
  }
  return {
    line: 'Air quality: Very poor — take it easy outside and favour indoor breaks.',
    textClass: 'text-rose-200/90',
  };
}
