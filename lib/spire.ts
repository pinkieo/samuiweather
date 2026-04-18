/** Spire Weather API — gedeelde constanten, forecast-mapping + WAQI-merge. */

export const SPIRE_API_BASE = 'https://api.wx.spire.com';

/** Koh Samui center — o.a. WAQI geo (ziekenhuis / eiland). */
export const SAMUI_CENTER = { lat: 9.512, lon: 100.0136 } as const;

export function getSpireApiToken(): string {
  return (
    process.env.SPIRE_API_TOKEN?.trim() ||
    process.env.SPIRE_API_KEY?.trim() ||
    ''
  );
}

export function buildForecastPointUrl(
  lat: number,
  lon: number,
  bundles: string = 'basic',
  options?: { timeBundle?: string; forecastHours?: number },
): string {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    bundles,
  });
  /** ~2 days hourly steps (Spire) — needed so “tomorrow” has a full 24h strip. */
  if (options?.timeBundle) {
    params.set('time_bundle', options.timeBundle);
  }
  /** Some Spire deployments extend horizon when set (ignored safely if unsupported). */
  if (options?.forecastHours != null && Number.isFinite(options.forecastHours)) {
    params.set('forecast_hours', String(Math.round(options.forecastHours)));
  }
  return `${SPIRE_API_BASE}/forecast/point?${params.toString()}`;
}

/**
 * Spire Optimized Point — airport / WMO / UN/LOCODE (e.g. `VTSM` for Samui).
 * Same `time_bundle` / `forecast_hours` knobs as `/forecast/point` when your token has access.
 * @see https://developers.wx.spire.com — `SPIRE_OPTIMIZED_POINT_LOCATION` env to enable.
 */
export function buildForecastOptimizedPointUrl(
  location: string,
  bundles: string = 'basic',
  options?: { timeBundle?: string; forecastHours?: number },
): string {
  const params = new URLSearchParams({
    location: location.trim(),
    bundles,
  });
  if (options?.timeBundle) {
    params.set('time_bundle', options.timeBundle);
  }
  if (options?.forecastHours != null && Number.isFinite(options.forecastHours)) {
    params.set('forecast_hours', String(Math.round(options.forecastHours)));
  }
  return `${SPIRE_API_BASE}/forecast/point/optimized?${params.toString()}`;
}

/**
 * When set (e.g. `VTSM`), {@link getForecastMergedAt} tries optimized point first for richer hourly depth.
 */
export function getSpireOptimizedPointLocationFromEnv(): string | null {
  const v =
    process.env.SPIRE_OPTIMIZED_POINT_LOCATION?.trim() ||
    process.env.SPIRE_OPTIMIZED_LOCATION?.trim();
  return v || null;
}

/**
 * Spire v4 Tides Point — `/tides/point` met start + horizon (niet legacy forecast/point/tides).
 */
function isoUtcZNoMs(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function buildTidesPointUrl(
  lat: number,
  lon: number,
  options?: { forecastHours?: number; startDatetimeIsoUtc?: string },
): string {
  const start = options?.startDatetimeIsoUtc ?? isoUtcZNoMs();
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    start_datetime: start,
    forecast_hours: String(options?.forecastHours ?? 24),
  });
  return `${SPIRE_API_BASE}/tides/point?${params.toString()}`;
}

function hintForStatus(status: number): string | undefined {
  if (status === 404) {
    return 'Gebruik api.wx.spire.com (niet api.spire.com); controleer pad en regio.';
  }
  if (status === 403) {
    return 'Bundle mogelijk niet op dit token geactiveerd (bijv. maritime_atmos).';
  }
  return undefined;
}

export async function spireGetJson(url: string, token: string) {
  const response = await fetch(url, {
    headers: { 'spire-api-key': token },
  });
  const data: unknown = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    data,
    hint: response.ok ? undefined : hintForStatus(response.status),
  };
}

export function kelvinToCelsius(k: number): number {
  return k - 273.15;
}

export function metersPerSecondToKnots(ms: number): number {
  return ms * 1.94384;
}

/** °C from Kelvin, one decimal (matches Spire precision in UI). */
export function convertSpireValue(
  value: number,
  type: 'temp' | 'wind',
): number {
  if (type === 'temp') {
    const c = value - 273.15;
    return Math.round(c * 10) / 10;
  }
  if (type === 'wind') {
    const ms = Number(value);
    if (Number.isNaN(ms)) return 0;
    return Math.round(ms * 100) / 100;
  }
  return value;
}

/** Display helper for Spire-derived °C values */
export function formatTempC(n: number | null | undefined): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toFixed(1);
}

/** Display helper for Spire-derived wind (m/s — Spire `wind_speed` is SI). */
export function formatWindMs(n: number | null | undefined): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toFixed(1);
}

/** Eén uniforme rij voor MapViewer: Spire + live WAQI alleen op index 0. */
export interface SamuiWeatherForecastRow {
  time: string;
  temp: number;
  feelsLike: number;
  /** m/s (Spire surface wind) */
  windSpeed: number;
  /** m/s */
  windGust: number;
  windDir: number;
  precip: number;
  humidity: number;
  precipRate: number;
  uvIndex: number | null;
  pm25: number | null;
  aqi: number | null;
  aqiStatus: string | null;
  cloudCover: number;
  pop: number;
  /** Alleen index 0 + WAQI ok */
  station?: string | null;
}

export function getAQIDescription(aqi: number | undefined | null): string {
  if (aqi == null || Number.isNaN(aqi)) return 'Unknown';
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for sensitive groups';
  if (aqi <= 200) return 'Unhealthy';
  return 'Very unhealthy';
}

function pickFirstNumber(
  v: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const k of keys) {
    const x = v[k];
    if (typeof x === 'number' && !Number.isNaN(x)) return x;
  }
  return null;
}

type SpirePointRow = {
  times?: { valid_time?: string };
  values?: Record<string, number | undefined>;
};

function mapSpirePointRow(entry: unknown): Omit<
  SamuiWeatherForecastRow,
  'aqi' | 'aqiStatus' | 'station'
> {
  const e = entry as SpirePointRow;
  const v = e.values ?? {};
  const vr = v as Record<string, unknown>;

  const uv =
    pickFirstNumber(vr, [
      'uv_index',
      'ultraviolet_index',
      'UV_index',
      'surface_uv_index',
    ]) ?? null;

  const pm25 =
    pickFirstNumber(vr, [
      'pm2_5',
      'pm25',
      'mass_concentration_of_pm2p5_ambient_aerosol_in_air',
      'particulate_matter_2_5',
    ]) ?? null;

  const popRaw =
    pickFirstNumber(vr, [
      'probability_of_precipitation',
      'pop',
      'probability_of_precipitation_1hr',
    ]) ?? 0;

  return {
    time: e.times?.valid_time ?? new Date().toISOString(),
    temp: convertSpireValue(Number(v.air_temperature ?? 293.15), 'temp'),
    feelsLike: convertSpireValue(Number(v.apparent_temperature ?? v.air_temperature ?? 293.15), 'temp'),
    windSpeed: convertSpireValue(Number(v.wind_speed ?? 0), 'wind'),
    windGust: convertSpireValue(Number(v.wind_gust ?? 0), 'wind'),
    windDir: Number(v.wind_direction ?? 0),
    precip: Number(
      pickFirstNumber(vr, ['precipitation_amount', 'precipitation_amount_1hr']) ?? 0,
    ),
    humidity: Number(v.relative_humidity ?? 0),
    precipRate: Number(
      pickFirstNumber(vr, ['precipitation_rate', 'precipitation_amount_1hr']) ?? 0,
    ),
    cloudCover: Number(
      pickFirstNumber(vr, ['cloud_cover', 'total_cloud_cover']) ?? 0,
    ),
    pop: popRaw <= 1 && popRaw > 0 ? Math.round(popRaw * 100) : Number(popRaw),
    uvIndex: uv,
    pm25,
  };
}

type WaqiPayload = {
  status?: string;
  data?: {
    aqi?: number;
    iaqi?: { pm25?: { v?: number } };
    city?: { name?: string };
  };
};

/** OpenUV `/forecast` — geneste arrays met `{ uv, uv_time }`. */
function collectOpenUvForecastRows(
  node: unknown,
  out: { uv: number; uv_time: string }[],
): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const x of node) collectOpenUvForecastRows(x, out);
    return;
  }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const uvTime =
      typeof o.uv_time === 'string'
        ? o.uv_time
        : typeof o.time === 'string'
          ? o.time
          : null;
    if (typeof o.uv === 'number' && uvTime) {
      out.push({ uv: o.uv, uv_time: uvTime });
      return;
    }
    for (const v of Object.values(o)) {
      if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
        collectOpenUvForecastRows(v, out);
      }
    }
  }
}

/** UTC-uur-bucket (ms sinds epoch) → lookup key voor Spire `valid_time` vs OpenUV `uv_time`. */
function utcHourBucketMs(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return NaN;
  return Math.floor(t / 3600000) * 3600000;
}

function buildOpenUvForecastHourMap(uvForecastData: unknown): Map<number, number> {
  const map = new Map<number, number>();
  const rows: { uv: number; uv_time: string }[] = [];
  collectOpenUvForecastRows(uvForecastData, rows);
  for (const { uv, uv_time } of rows) {
    const ms = utcHourBucketMs(uv_time);
    if (Number.isNaN(ms)) continue;
    map.set(ms, Math.round(uv * 10) / 10);
  }
  return map;
}

function lookupOpenUvForecastForValidTime(
  hourMap: Map<number, number>,
  validTimeIso: string,
): number | null {
  const t = new Date(validTimeIso).getTime();
  if (Number.isNaN(t)) return null;
  const bucket = Math.floor(t / 3600000) * 3600000;
  if (hourMap.has(bucket)) return hourMap.get(bucket)!;
  for (const delta of [0, -3600000, 3600000, -7200000, 7200000]) {
    const b = Math.floor((t + delta) / 3600000) * 3600000;
    const v = hourMap.get(b);
    if (v != null) return v;
  }
  return null;
}

/**
 * Ruwe Spire `data[]` + WAQI JSON. Index 0 krijgt live smog (AQI/PM2.5);
 * andere uren: Spire-waarden, `aqi`/`aqiStatus` null.
 *
 * UV: OpenUV **hourly forecast** (`/forecast`) wordt per `valid_time` gematcht; zo heeft elk uur
 * een index (niet alleen `/uv` op index 0). Daarna: Spire `uv_index` als die er is; anders
 * alleen op index 0 nog `/uv` (huidige waarde).
 */
export function mergeSpireWithWaqi(
  spireRows: unknown[],
  waqiData: unknown,
  uvData?: unknown,
  uvForecastData?: unknown,
): SamuiWeatherForecastRow[] {
  const waqi = waqiData as WaqiPayload | null;
  const waqiOk =
    waqi != null &&
    typeof waqi === 'object' &&
    waqi.status === 'ok' &&
    waqi.data != null;

  const uvResult = (uvData as { result?: { uv?: number } } | null)?.result;
  const uvHourMap = buildOpenUvForecastHourMap(uvForecastData);

  return spireRows.map((row, index) => {
    const base = mapSpirePointRow(row);
    const isNow = index === 0;

    let pm = base.pm25;
    let aqiVal = null;
    let aqiStatus = null;
    let station = null;

    let uvVal = base.uvIndex;
    const fromForecast = lookupOpenUvForecastForValidTime(uvHourMap, base.time);
    if (fromForecast != null) {
      uvVal = fromForecast;
    } else if (isNow && uvResult && typeof uvResult.uv === 'number') {
      uvVal = Math.round(uvResult.uv * 10) / 10;
    }

    if (isNow) {
      if (waqiOk && waqi!.data) {
        const d = waqi!.data;
        pm = typeof d.iaqi?.pm25?.v === 'number' ? d.iaqi.pm25.v : base.pm25;
        aqiVal = typeof d.aqi === 'number' ? d.aqi : null;
        aqiStatus = getAQIDescription(d.aqi ?? undefined);
        station = d.city?.name ?? null;
      }
    }

    return {
      ...base,
      pm25: pm,
      aqi: aqiVal,
      aqiStatus,
      station,
      uvIndex: uvVal,
    };
  });
}

export const FORECAST_BUNDLES_VACATION = 'basic,maritime_atmos,solar';

/** Legacy: zelfde shape zonder WAQI. */
export function mapSpireForecastPointData(raw: unknown): SamuiWeatherForecastRow[] {
  if (!raw || typeof raw !== 'object' || !('data' in raw)) return [];
  const { data } = raw as { data: unknown };
  if (!Array.isArray(data)) return [];
  return mergeSpireWithWaqi(data, null);
}

/**
 * Parallel Spire (+ bundle-fallback) + WAQI at a point; één array voor de frontend.
 */
export async function getForecastMergedAt(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<SamuiWeatherForecastRow[]> {
  const token = getSpireApiToken();
  if (!token) {
    throw new Error('SPIRE_API_TOKEN ontbreekt');
  }

  const waqiToken = (process.env.WAQI_API_TOKEN || process.env.NEXT_PUBLIC_AQICN_TOKEN)?.trim();
  const uvKey = process.env.NEXT_PUBLIC_OPENUV_API_KEY?.trim();

  /**
   * Need >24 lead hours so “tomorrow” in Asia/Bangkok still reaches 23:00 (24h-only data
   * ends tomorrow at the same clock time as now → e.g. 19:00).
   */
  const MIN_HOURS_FOR_FULL_NEXT_DAY = 48;

  const fetchSpire = async (): Promise<{ data?: unknown[] }> => {
    type Att = { timeBundle?: string; forecastHours?: number };
    const attempts: Att[] = [
      { timeBundle: 'hourly', forecastHours: 72 },
      { timeBundle: 'hourly', forecastHours: 48 },
      { timeBundle: 'hourly' },
      { timeBundle: 'hourly_6day' },
      {},
    ];

    let best: { data?: unknown[] } | null = null;
    let bestLen = 0;

    const consider = (json: { data?: unknown[] }) => {
      const len = Array.isArray(json.data) ? json.data.length : 0;
      if (len > bestLen) {
        best = json;
        bestLen = len;
      }
    };

    const bundleList = [
      FORECAST_BUNDLES_VACATION,
      'basic,maritime_atmos',
      'basic',
    ] as const;

    const runSeries = async (
      source: 'optimized' | 'point',
      makeUrl: (bundles: string, att: Att) => string,
    ): Promise<{ data?: unknown[] } | null> => {
      for (const bundles of bundleList) {
        attemptLoop: for (const att of attempts) {
          const url = makeUrl(bundles, att);
          const r = await fetch(url, {
            headers: { 'spire-api-key': token },
            signal,
            next: { revalidate: 900 },
          });
          if (r.ok) {
            const json = (await r.json()) as { data?: unknown[] };
            const len = Array.isArray(json.data) ? json.data.length : 0;
            if (len >= MIN_HOURS_FOR_FULL_NEXT_DAY) {
              if (source === 'optimized') {
                const loc = getSpireOptimizedPointLocationFromEnv();
                if (loc) {
                  console.log(
                    '[Spire] Optimized point forecast (≥48h hourly steps):',
                    loc,
                  );
                }
              }
              return json;
            }
            consider(json);
            continue;
          }
          if (r.status === 403) {
            break attemptLoop;
          }
          if (r.status === 400 || r.status === 404 || r.status === 422) {
            continue;
          }
          throw new Error(`Spire HTTP ${r.status}`);
        }
      }
      return null;
    };

    const optLoc = getSpireOptimizedPointLocationFromEnv();
    if (optLoc) {
      const fromOpt = await runSeries('optimized', (bundles, att) =>
        buildForecastOptimizedPointUrl(optLoc, bundles, {
          timeBundle: att.timeBundle,
          forecastHours: att.forecastHours,
        }),
      );
      if (fromOpt) {
        return fromOpt;
      }
    }

    const fromPoint = await runSeries('point', (bundles, att) =>
      buildForecastPointUrl(lat, lon, bundles, {
        timeBundle: att.timeBundle,
        forecastHours: att.forecastHours,
      }),
    );
    if (fromPoint) {
      return fromPoint;
    }

    if (best && bestLen > 0) {
      return best;
    }
    throw new Error('Spire 403');
  };

  const fetchWaqi = (): Promise<unknown> => {
    if (!waqiToken) return Promise.resolve(null);
    const url = `https://api.waqi.info/feed/geo:${lat};${lon}/?token=${encodeURIComponent(waqiToken)}`;
    return fetch(url, { signal, next: { revalidate: 60 } })
      .then((r) => (r.ok ? r.json() : null))
      .catch((e) => {
        console.error('Spire merge fetchWaqi err:', e);
        return null;
      });
  };

  const fetchUv = (): Promise<unknown> => {
    if (!uvKey) return Promise.resolve(null);
    const url = `https://api.openuv.io/api/v1/uv?lat=${lat}&lng=${lon}`;
    return fetch(url, {
      headers: { 'x-access-token': uvKey },
      signal,
      next: { revalidate: 60 },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch((e) => {
        console.error('Spire merge fetchUv err:', e);
        return null;
      });
  };

  /** Hourly UV per `uv_time` — nodig omdat Spire vaak geen `uv_index` per uur levert. */
  const fetchUvForecast = (): Promise<unknown> => {
    if (!uvKey) return Promise.resolve(null);
    const url = `https://api.openuv.io/api/v1/forecast?lat=${lat}&lng=${lon}&alt=0`;
    return fetch(url, {
      headers: { 'x-access-token': uvKey },
      signal,
      next: { revalidate: 60 },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch((e) => {
        console.error('Spire merge fetchUvForecast err:', e);
        return null;
      });
  };

  const [spireJson, waqiJson, uvJson, uvForecastJson] = await Promise.all([
    fetchSpire(),
    fetchWaqi(),
    fetchUv(),
    fetchUvForecast(),
  ]);

  // Debug logs
  console.log(
    '[mergeSpireWithWaqi] waqi ok?',
    !!waqiJson,
    '| uv ok?',
    !!uvJson,
    '| uv forecast ok?',
    !!uvForecastJson,
  );

  let rows = Array.isArray(spireJson?.data) ? spireJson.data : [];
  
  // Filter historical data out, only keep from the current hour forward
  const nowMs = Date.now();
  const currentHourMs = nowMs - (nowMs % (60 * 60 * 1000));

  rows = rows.filter((row: any) => {
    const vt = row?.times?.valid_time;
    if (!vt) return true;
    return new Date(vt).getTime() >= currentHourMs;
  });

  return mergeSpireWithWaqi(rows, waqiJson, uvJson, uvForecastJson);
}

/** Koh Samui dashboard default. */
export async function getSamuiForecastMerged(
  signal?: AbortSignal,
): Promise<SamuiWeatherForecastRow[]> {
  return getForecastMergedAt(SAMUI_CENTER.lat, SAMUI_CENTER.lon, signal);
}
