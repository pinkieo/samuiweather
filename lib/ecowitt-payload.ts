/**
 * Normalize Ecowitt custom-upload query params → metric DB row.
 * Used by HTTP ingest and Ecowitt Cloud API sync.
 */

export type EcowittPayload = Record<string, string>;

export const DEFAULT_ECOWITT_LOCATION_ID = 'baan_ton_kluay';

export function firstNumber(payload: EcowittPayload, keys: string[]): number | null {
  for (const key of keys) {
    const raw = payload[key];
    if (raw == null || raw.trim() === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function fahrenheitToCelsius(f: number | null): number | null {
  return f == null ? null : Math.round(((f - 32) * 5 / 9) * 100) / 100;
}

export function mphToMs(mph: number | null): number | null {
  return mph == null ? null : Math.round(mph * 0.44704 * 100) / 100;
}

export function inchToMm(inches: number | null): number | null {
  return inches == null ? null : Math.round(inches * 25.4 * 100) / 100;
}

export function inHgToHpa(inHg: number | null): number | null {
  return inHg == null ? null : Math.round(inHg * 33.8638866667 * 100) / 100;
}

export function mileToKm(miles: number | null): number | null {
  return miles == null ? null : Math.round(miles * 1.609344 * 100) / 100;
}

export function parseObservedAt(payload: EcowittPayload): string {
  const raw = payload.dateutc ?? payload.date_utc ?? payload.time;
  if (raw) {
    const trimmed = raw.trim();
    if (/^\d{10,13}$/.test(trimmed)) {
      const ms = trimmed.length > 10 ? Number(trimmed) : Number(trimmed) * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    const normalized = trimmed.replace(' ', 'T');
    const iso = /Z$|[+-]\d\d:?\d\d$/.test(normalized)
      ? normalized
      : `${normalized}Z`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function batteryStatusFromPayload(payload: EcowittPayload): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    const k = key.toLowerCase();
    if (k.includes('batt') || k.endsWith('battery')) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function buildEcowittDbRow(payload: EcowittPayload) {
  const locationId = payload.location_id?.trim() || DEFAULT_ECOWITT_LOCATION_ID;
  return {
    observed_at: parseObservedAt(payload),
    location_id: locationId,
    station_type: payload.stationtype ?? payload.station_type ?? null,
    station_id: payload.PASSKEY ?? payload.passkey ?? payload.station_id ?? null,

    temperature_c: fahrenheitToCelsius(firstNumber(payload, ['tempf', 'outtempf'])),
    humidity_pct: firstNumber(payload, ['humidity', 'outhumidity']),
    indoor_temperature_c: fahrenheitToCelsius(firstNumber(payload, ['indoortempf', 'tempinf'])),
    indoor_humidity_pct: firstNumber(payload, ['indoorhumidity', 'humidityin']),

    relative_pressure_hpa: inHgToHpa(firstNumber(payload, ['baromrelin', 'baromrel'])),
    absolute_pressure_hpa: inHgToHpa(firstNumber(payload, ['baromabsin', 'baromabs'])),

    wind_speed_ms: mphToMs(firstNumber(payload, ['windspeedmph'])),
    wind_gust_ms: mphToMs(firstNumber(payload, ['windgustmph', 'maxdailygust'])),
    wind_direction_deg: firstNumber(payload, ['winddir']),

    rain_rate_mmh: inchToMm(firstNumber(payload, ['rainratein'])),
    rain_hour_mm: inchToMm(firstNumber(payload, ['hourlyrainin'])),
    rain_day_mm: inchToMm(firstNumber(payload, ['dailyrainin'])),
    rain_week_mm: inchToMm(firstNumber(payload, ['weeklyrainin'])),
    rain_month_mm: inchToMm(firstNumber(payload, ['monthlyrainin'])),
    rain_year_mm: inchToMm(firstNumber(payload, ['yearlyrainin'])),
    rain_event_mm: inchToMm(firstNumber(payload, ['eventrainin'])),

    solar_wm2: firstNumber(payload, ['solarradiation']),
    uv_index: firstNumber(payload, ['uv']),

    lightning_distance_km: mileToKm(firstNumber(payload, ['lightningdistancemi'])),
    lightning_count: firstNumber(payload, ['lightningcount']),

    battery_status: batteryStatusFromPayload(payload),
    raw_json: payload,
  };
}
