/**
 * Hourly pressure-level wind for the Samui nowcast.
 *
 * Open-Meteo `wind_speed_*hPa` is km/h and `wind_direction_*hPa` is degrees
 * (direction the wind comes from). The meteorologist checked that pair at
 * about 9.56 N, 100.03 E. The nowcast converts km/h to m/s when it steers.
 * A missing or rejected response stores no speed and no direction.
 */

export const OPEN_METEO_STEERING_LAT = 9.56;
export const OPEN_METEO_STEERING_LON = 100.03;
export const OPEN_METEO_STEERING_FORECAST_DAYS = 16;
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_STEERING_KEY = 'open_meteo_steering';

const LEVELS = ['700', '850', '500'] as const;
export type OpenMeteoLevel = (typeof LEVELS)[number];
export type OpenMeteoLevelName = '700hPa' | '850hPa' | '500hPa';

export type OpenMeteoSteeringHour = {
  source: 'open-meteo';
  fetched_at_utc: string;
  requested_latitude: number;
  requested_longitude: number;
  latitude: number | null;
  longitude: number | null;
  wind_speed_unit: 'km/h';
  wind_direction_unit: 'degrees';
  levels_present: OpenMeteoLevelName[];
  wind_speed_700hpa_kmh: number | null;
  wind_direction_700hpa_deg: number | null;
  wind_speed_850hpa_kmh: number | null;
  wind_direction_850hpa_deg: number | null;
  wind_speed_500hpa_kmh: number | null;
  wind_direction_500hpa_deg: number | null;
  valid_time_utc: string;
};

export type OpenMeteoSteeringFailure = {
  source: 'open-meteo';
  fetched_at_utc: string;
  requested_latitude: number;
  requested_longitude: number;
  error: 'wind missing';
  detail: string;
};

export type OpenMeteoSteeringBlock = OpenMeteoSteeringHour | OpenMeteoSteeringFailure;

export type OpenMeteoSteeringOk = {
  ok: true;
  hours: OpenMeteoSteeringHour[];
};

export type OpenMeteoSteeringErr = {
  ok: false;
  reason: string;
  failure: OpenMeteoSteeringFailure;
};

export function kmhToMps(kmh: number): number {
  return kmh / 3.6;
}

function utcHourBucket(iso: string): number | null {
  const t = Date.parse(iso.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(t) ? Math.floor(t / 3_600_000) * 3_600_000 : null;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function directionDeg(v: unknown): number | null {
  const n = finite(v);
  if (n == null || n < 0 || n > 360) return null;
  return n === 360 ? 0 : n;
}

function speedKmh(v: unknown): number | null {
  const n = finite(v);
  if (n == null || n < 0) return null;
  return n;
}

function levelName(level: OpenMeteoLevel): OpenMeteoLevelName {
  return `${level}hPa`;
}

function unitsAreKmh(payload: Record<string, unknown>): boolean {
  const units = payload.hourly_units;
  if (!units || typeof units !== 'object') return true;
  const record = units as Record<string, unknown>;
  for (const level of LEVELS) {
    const unit = record[`wind_speed_${level}hPa`];
    if (unit == null) continue;
    if (unit !== 'km/h') return false;
  }
  return true;
}

/**
 * Parse one Open-Meteo forecast body. Speeds stay in km/h.
 * A body whose speed unit is not km/h is rejected.
 */
export function parseOpenMeteoSteering(
  payload: unknown,
  fetchedAtUtc: string,
): OpenMeteoSteeringOk | OpenMeteoSteeringErr {
  const failure = (detail: string): OpenMeteoSteeringErr => ({
    ok: false,
    reason: detail,
    failure: {
      source: 'open-meteo',
      fetched_at_utc: fetchedAtUtc,
      requested_latitude: OPEN_METEO_STEERING_LAT,
      requested_longitude: OPEN_METEO_STEERING_LON,
      error: 'wind missing',
      detail,
    },
  });

  if (!payload || typeof payload !== 'object') return failure('Open-Meteo response was empty.');
  const root = payload as Record<string, unknown>;
  if (root.error === true) {
    const detail = typeof root.reason === 'string' ? root.reason : 'Open-Meteo returned an error.';
    return failure(detail);
  }
  if (!unitsAreKmh(root)) {
    return failure('Open-Meteo wind speed unit was not km/h. Wind missing.');
  }
  const hourly = root.hourly;
  if (!hourly || typeof hourly !== 'object') return failure('Open-Meteo response has no hourly wind.');
  const block = hourly as Record<string, unknown>;
  const times = block.time;
  if (!Array.isArray(times) || times.length === 0) {
    return failure('Open-Meteo response has no hourly times.');
  }
  const series = Object.fromEntries(
    LEVELS.map((level) => [
      level,
      {
        speed: block[`wind_speed_${level}hPa`],
        direction: block[`wind_direction_${level}hPa`],
      },
    ]),
  ) as Record<OpenMeteoLevel, { speed: unknown; direction: unknown }>;
  const anySeries = LEVELS.some(
    (level) => Array.isArray(series[level].speed) || Array.isArray(series[level].direction),
  );
  if (!anySeries) return failure('Open-Meteo response has no pressure-level wind.');

  const latitude = finite(root.latitude);
  const longitude = finite(root.longitude);
  const hours: OpenMeteoSteeringHour[] = [];
  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    if (typeof time !== 'string') continue;
    const bucket = utcHourBucket(time);
    if (bucket == null) continue;
    const row: OpenMeteoSteeringHour = {
      source: 'open-meteo',
      fetched_at_utc: fetchedAtUtc,
      requested_latitude: OPEN_METEO_STEERING_LAT,
      requested_longitude: OPEN_METEO_STEERING_LON,
      latitude,
      longitude,
      wind_speed_unit: 'km/h',
      wind_direction_unit: 'degrees',
      levels_present: [],
      wind_speed_700hpa_kmh: null,
      wind_direction_700hpa_deg: null,
      wind_speed_850hpa_kmh: null,
      wind_direction_850hpa_deg: null,
      wind_speed_500hpa_kmh: null,
      wind_direction_500hpa_deg: null,
      valid_time_utc: new Date(bucket).toISOString(),
    };
    for (const level of LEVELS) {
      const speedArr = series[level].speed;
      const dirArr = series[level].direction;
      const speed = Array.isArray(speedArr) ? speedKmh(speedArr[i]) : null;
      const direction = Array.isArray(dirArr) ? directionDeg(dirArr[i]) : null;
      if (speed == null || direction == null) continue;
      row.levels_present.push(levelName(level));
      if (level === '700') {
        row.wind_speed_700hpa_kmh = speed;
        row.wind_direction_700hpa_deg = direction;
      } else if (level === '850') {
        row.wind_speed_850hpa_kmh = speed;
        row.wind_direction_850hpa_deg = direction;
      } else {
        row.wind_speed_500hpa_kmh = speed;
        row.wind_direction_500hpa_deg = direction;
      }
    }
    hours.push(row);
  }
  if (!hours.length) return failure('Open-Meteo hourly times could not be read.');
  return { ok: true, hours };
}

export function steeringBlockForValidTime(
  parsed: OpenMeteoSteeringOk | OpenMeteoSteeringErr,
  validTimeIso: string,
): OpenMeteoSteeringBlock {
  if (!parsed.ok) return parsed.failure;
  const bucket = utcHourBucket(validTimeIso);
  const hour = bucket == null ? undefined : parsed.hours.find((row) => Date.parse(row.valid_time_utc) === bucket);
  if (!hour) {
    return {
      source: 'open-meteo',
      fetched_at_utc: parsed.hours[0]?.fetched_at_utc ?? new Date(0).toISOString(),
      requested_latitude: OPEN_METEO_STEERING_LAT,
      requested_longitude: OPEN_METEO_STEERING_LON,
      error: 'wind missing',
      detail: 'No Open-Meteo hour for this valid time.',
    };
  }
  return hour;
}

export function withOpenMeteoSteering(
  values: Record<string, unknown>,
  block: OpenMeteoSteeringBlock,
): Record<string, unknown> {
  return { ...values, [OPEN_METEO_STEERING_KEY]: block };
}

export type SteeringVectors = {
  /** True when this row carries an Open-Meteo hour, including an hour with no levels. */
  fromOpenMeteo: boolean;
  wind700: { speedMps: number; fromDeg: number } | null;
  wind850: { speedMps: number; fromDeg: number } | null;
  wind500: { speedMps: number; fromDeg: number } | null;
  levels: OpenMeteoLevelName[];
};

function pair(speedKmh: number | null, fromDeg: number | null): { speedMps: number; fromDeg: number } | null {
  if (speedKmh == null || fromDeg == null) return null;
  return { speedMps: kmhToMps(speedKmh), fromDeg };
}

/** km/h on the stored block becomes m/s for the nowcast. An error block supplies no wind. */
export function steeringVectorsFromValues(
  values: Record<string, unknown> | null | undefined,
): SteeringVectors {
  const empty: SteeringVectors = {
    fromOpenMeteo: false,
    wind700: null,
    wind850: null,
    wind500: null,
    levels: [],
  };
  const block = values?.[OPEN_METEO_STEERING_KEY];
  if (!block || typeof block !== 'object') return empty;
  const row = block as Partial<OpenMeteoSteeringHour & OpenMeteoSteeringFailure>;
  if (row.source !== 'open-meteo') return empty;
  if (row.error === 'wind missing') return { ...empty, fromOpenMeteo: false };
  const wind700 = pair(finite(row.wind_speed_700hpa_kmh), finite(row.wind_direction_700hpa_deg));
  const wind850 = pair(finite(row.wind_speed_850hpa_kmh), finite(row.wind_direction_850hpa_deg));
  const wind500 = pair(finite(row.wind_speed_500hpa_kmh), finite(row.wind_direction_500hpa_deg));
  const levels: OpenMeteoLevelName[] = [];
  if (wind700) levels.push('700hPa');
  if (wind850) levels.push('850hPa');
  if (wind500) levels.push('500hPa');
  return { fromOpenMeteo: true, wind700, wind850, wind500, levels };
}

export function openMeteoSteeringUrl(): string {
  const params = new URLSearchParams({
    latitude: String(OPEN_METEO_STEERING_LAT),
    longitude: String(OPEN_METEO_STEERING_LON),
    hourly: [
      'wind_speed_700hPa',
      'wind_direction_700hPa',
      'wind_speed_850hPa',
      'wind_direction_850hPa',
      'wind_speed_500hPa',
      'wind_direction_500hPa',
    ].join(','),
    timezone: 'GMT',
    forecast_days: String(OPEN_METEO_STEERING_FORECAST_DAYS),
    wind_speed_unit: 'kmh',
  });
  return `${OPEN_METEO_FORECAST_URL}?${params.toString()}`;
}

export async function fetchOpenMeteoSteering(opts?: {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: Date;
}): Promise<OpenMeteoSteeringOk | OpenMeteoSteeringErr> {
  const fetchedAt = (opts?.now ?? new Date()).toISOString();
  const fetchImpl = opts?.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(openMeteoSteeringUrl(), {
      cache: 'no-store',
      signal: opts?.signal,
      headers: { 'User-Agent': 'SamuiWeatherDashboard/1.0' },
    });
    if (!res.ok) {
      const detail = `Open-Meteo status ${res.status}. Wind missing.`;
      return {
        ok: false,
        reason: detail,
        failure: {
          source: 'open-meteo',
          fetched_at_utc: fetchedAt,
          requested_latitude: OPEN_METEO_STEERING_LAT,
          requested_longitude: OPEN_METEO_STEERING_LON,
          error: 'wind missing',
          detail,
        },
      };
    }
    return parseOpenMeteoSteering(await res.json(), fetchedAt);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Open-Meteo request failed.';
    return {
      ok: false,
      reason: `${detail} Wind missing.`,
      failure: {
        source: 'open-meteo',
        fetched_at_utc: fetchedAt,
        requested_latitude: OPEN_METEO_STEERING_LAT,
        requested_longitude: OPEN_METEO_STEERING_LON,
        error: 'wind missing',
        detail: `${detail} Wind missing.`,
      },
    };
  }
}
