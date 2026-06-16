/**
 * Heat-index style “feels like” from air temperature and relative humidity.
 * T = °C. The regression below expects **relative humidity as a 0–1 fraction** (not 0–100%).
 *
 * Spire and most APIs expose RH as 0–100 — we convert automatically.
 */

const FEELS_MAX_C = 55;
/** If model output is wildly off, skip rather than alarming the guest. */
const FEELS_ABOVE_TEMP_MAX_DELTA = 28;

const TZ_BKK = 'Asia/Bangkok';

/** Minutes since local midnight in Bangkok (ICT), 0 … 1439. */
function bangkokMinutesFromMidnightUtcMs(utcMs: number): number {
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return 12 * 60;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_BKK,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hv = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const mv = parts.find((p) => p.type === 'minute')?.value ?? '0';
  const h = parseInt(hv, 10) % 24;
  const m = parseInt(mv, 10);
  return h * 60 + m;
}

/** Local hour 0–23 in Bangkok (ICT) for a UTC instant. */
export function bangkokHourFromUtcMs(utcMs: number): number {
  return Math.floor(bangkokMinutesFromMidnightUtcMs(utcMs) / 60);
}

/** Same ICT clock as {@link bangkokHourFromUtcMs}, as fractional hours (17.5 = 17:30). */
export function bangkokHourDecimalFromUtcMs(utcMs: number): number {
  return bangkokMinutesFromMidnightUtcMs(utcMs) / 60;
}

/** Tropical strip: sun sets ~18:00 ICT — “shade” copy only when tourists are still outdoors. */
const FEELS_HINT_DAYLIGHT_START_H = 7;
const FEELS_HINT_DAYLIGHT_END_H = 17.5;

/**
 * Normalize API humidity to 0–1 for the polynomial.
 * - (0, 1] → already a fraction (e.g. 0.67)
 * - (1, 100] → percent (e.g. 67 → 0.67)
 * - &gt; 100 → invalid
 */
export function relativeHumidityToFraction(humidity: number): number | null {
  if (!Number.isFinite(humidity) || humidity < 0) return null;
  if (humidity > 100) return null;
  if (humidity > 1) return humidity / 100;
  return Math.min(1, Math.max(0, humidity));
}

/** UI label 0–100% whether the API sent percent or fraction. */
export function relativeHumidityPercentForDisplay(humidity: number | null | undefined): string {
  if (humidity == null || !Number.isFinite(Number(humidity))) return '—';
  const f = relativeHumidityToFraction(Number(humidity));
  if (f == null) return '—';
  return String(Math.round(f * 100));
}

/**
 * Steadman-style heat index adapted to °C; RH must be **fraction** 0–1 inside the polynomial.
 */
export function getFeelsLikeTemperature(
  tempC: number,
  humidity: number | null | undefined,
): number | null {
  if (!Number.isFinite(tempC)) return null;
  if (humidity == null) return null;

  const RH = relativeHumidityToFraction(Number(humidity));
  if (RH == null) return null;

  /** Formula invalid or meaningless far outside tropical day range */
  if (tempC < -10 || tempC > 48) return null;

  const T = tempC;
  const feels =
    -8.784694 +
    1.61139411 * T +
    2.338548838 * RH +
    0.14611605 * T * RH -
    0.012308094 * T * T +
    0.01642482778 * RH * RH +
    0.002211732 * T * T * RH +
    0.00072546 * T * RH * RH -
    0.000003582 * T * T * RH * RH;

  if (!Number.isFinite(feels)) return null;
  if (feels > tempC + FEELS_ABOVE_TEMP_MAX_DELTA) return null;

  const capped = Math.min(FEELS_MAX_C, feels);
  /** Heat index should not sit far below air temp in humid tropical use */
  if (capped < tempC - 4) return null;
  return capped;
}

/**
 * Heat-index uplift vs air temperature (°C), ≥ 0. Used for beach scoring when Δ ≥ 4 matters.
 */
export function getFeelsLikeDeltaC(
  tempC: number,
  humidity: number | null | undefined,
): number {
  if (!Number.isFinite(tempC)) return 0;
  const hi = getFeelsLikeTemperature(tempC, humidity);
  if (hi == null) return 0;
  return Math.max(0, hi - tempC);
}

/**
 * Short English line when heat index is noticeably above actual temperature.
 * Only when (feels − temp) ≥ 2°C. Copy is **Bangkok local time** aware: shade/beach tone **07:00–17:30 ICT**,
 * night wording from **17:30** onward (tropical dusk ~18:00).
 *
 * @param whenUtcMs — instant for this forecast slot (ms). Prefer `new Date(row.time).getTime()`.
 *   If omitted, uses `Date.now()` (only suitable for “right now” UI).
 */
export function getFeelsLikeHumidityHint(
  tempC: number,
  humidity: number | null | undefined,
  whenUtcMs?: number,
): string | null {
  const hi = getFeelsLikeTemperature(tempC, humidity);
  if (hi == null) return null;
  const delta = hi - tempC;
  if (delta < 2) return null;

  const feelsRounded = Math.round(hi);
  const ms =
    whenUtcMs != null && Number.isFinite(whenUtcMs) ? whenUtcMs : Date.now();
  const bHour = bangkokHourDecimalFromUtcMs(ms);
  /** Daylight copy: beach / outdoor context (ICT; uses same clock as {@link bangkokHourFromUtcMs}). */
  const daylight =
    bHour >= FEELS_HINT_DAYLIGHT_START_H && bHour < FEELS_HINT_DAYLIGHT_END_H;

  if (daylight) {
    if (delta >= 4) {
      return `Feels like ${feelsRounded}°C — can feel sticky, take breaks in the shade`;
    }
    return `Feels like ${feelsRounded}°C — quite humid today`;
  }

  if (delta >= 4) {
    return `Feels like ${feelsRounded}°C — warm and humid night — good for sleeping with AC or fan`;
  }
  return `Feels like ${feelsRounded}°C — mild night — pleasant for a late walk if you like humidity`;
}
