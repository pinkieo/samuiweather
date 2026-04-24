/**
 * Spire Weather API — shared constants, forecast mapping + WAQI merge.
 *
 * **Product (what users mostly see):** Spire point forecast, merged tiers + (on Samui) OPF probability overlay on matching hours.
 * Ingest in Supabase → `sammi_forecast` / `sammi_daily_forecast` for `kans_*`, advice, reliability.
 * The UI can **nudge “now”** only via a private grid route — see `lib/forecast-reference.ts` (`blendReferenceNowcastIntoFirstRow`); Spire remains the lead timeline; that grid is a cross-check, not a second branded layer.
 * **To track skill over time:** compare archived `weather_forecast` to METAR + radar truth and (when live) ground sensors; `issuance` vs `valid_time` in views encodes the OPF / medium / long-horizon bands.
 */
import {
  computeSpireBeachSkyCloudCover,
  extractSpireCloudLayerInputs,
} from './spire-cloud-cover';
import { combinedSignal } from './promise-timeout';

export const SPIRE_API_BASE = 'https://api.wx.spire.com';

/** Koh Samui center — o.a. WAQI geo (ziekenhuis / eiland). */
export const SAMUI_CENTER = { lat: 9.5127, lon: 100.0137 } as const;

/** Baan Mook Taley / Ao Nang — Krabi dashboard product (same point as `BAAN_MOOK_TALEY_WGS84` in dashboard-regions). */
export const KRABI_FORECAST_POINT = { lat: 8.04561, lon: 98.78503 } as const;

/**
 * Samui OPF (`/forecast/point/optimized`) is tuned to the island site — do not overlay those
 * probabilities onto other lat/lon (would mislabel e.g. Krabi hourly POP).
 */
const SAMUI_OPF_OVERLAY_EPS = 0.06;

export function isSamuiOpfOverlayPoint(lat: number, lon: number): boolean {
  return (
    Math.abs(lat - SAMUI_CENTER.lat) <= SAMUI_OPF_OVERLAY_EPS &&
    Math.abs(lon - SAMUI_CENTER.lon) <= SAMUI_OPF_OVERLAY_EPS
  );
}


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
  options?: {
    timeBundle?: string;
    forecastHours?: number;
    /** ProSea / SOF-D etc. — Spire support: e.g. `sof-d` with `6_hourly_15day`. */
    product?: string;
    unitSystem?: string;
  },
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
  if (options?.product?.trim()) {
    params.set('product', options.product.trim());
  }
  if (options?.unitSystem?.trim()) {
    params.set('unit_system', options.unitSystem.trim());
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
  options?: {
    timeBundle?: string;
    forecastHours?: number;
    product?: string;
    unitSystem?: string;
  },
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
  if (options?.product?.trim()) {
    params.set('product', options.product.trim());
  }
  if (options?.unitSystem?.trim()) {
    params.set('unit_system', options.unitSystem.trim());
  }
  return `${SPIRE_API_BASE}/forecast/point/optimized?${params.toString()}`;
}

/** Default OPF site id (Koh Samui) — override with `SPIRE_OPF_LOCATION`. */
export const DEFAULT_OPF_LOCATION = 'custom:PR_W1XNKK0';
/** @deprecated use {@link DEFAULT_OPF_LOCATION} */
export const DEFAULT_SPIRE_OPF_LOCATION = DEFAULT_OPF_LOCATION;

/**
 * When set (e.g. `VTSM`), {@link getForecastMergedAt} tries optimized point first for richer hourly depth.
 */
export function getSpireOptimizedPointLocationFromEnv(): string | null {
  const v =
    process.env.SPIRE_OPF_LOCATION?.trim() ||
    process.env.SPIRE_OPTIMIZED_POINT_LOCATION?.trim() ||
    process.env.SPIRE_OPTIMIZED_LOCATION?.trim();
  return v || null;
}

/** OPF `/forecast/point/optimized` location — same default as `weather_engine_hourly.py`. */
export function getSpireOpfLocationFromEnv(): string {
  return getSpireOptimizedPointLocationFromEnv() ?? DEFAULT_OPF_LOCATION;
}

/**
 * OPF hourly probabilities (~72h) for Sammi **high** band (0–48h vs issuance in SQL view).
 * Bundles: env override, else `basic,thunderstorm`, then `basic`.
 */
async function fetchOpfProbabilities(
  token: string,
  spireFetchSignal: () => AbortSignal,
  pointOptions: () => { product?: string; unitSystem?: string },
): Promise<unknown[]> {
  if (process.env.SPIRE_OPF_ENABLED?.trim() === '0') return [];
  const opfLoc = getSpireOpfLocationFromEnv();
  let fh = 72;
  const fhRaw = process.env.SPIRE_OPF_FORECAST_HOURS?.trim();
  if (fhRaw) {
    const n = parseInt(fhRaw, 10);
    if (Number.isFinite(n)) fh = Math.min(120, Math.max(24, n));
  }
  const candidates = [
    process.env.SPIRE_OPF_BUNDLES?.trim(),
    'basic,thunderstorm',
    'basic',
  ].filter((b): b is string => Boolean(b));
  const seen = new Set<string>();
  for (const bundles of candidates) {
    if (seen.has(bundles)) continue;
    seen.add(bundles);
    const url = buildForecastOptimizedPointUrl(opfLoc, bundles, {
      timeBundle: 'hourly',
      forecastHours: fh,
      ...pointOptions(),
    });
    try {
      const res = await fetch(url, {
        headers: { 'spire-api-key': token },
        signal: spireFetchSignal(),
        next: { revalidate: 900 },
      });
      if (!res.ok) continue;
      const json = (await res.json().catch(() => ({}))) as { data?: unknown[] };
      if (Array.isArray(json.data) && json.data.length > 0) return json.data;
    } catch (e) {
      console.warn('[Spire] OPF probabilities fetch failed:', e);
    }
  }
  return [];
}

/**
 * Spire v4 Tides Point — `/tides/point` with start + horizon (not legacy forecast/point/tides).
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
    return 'Use api.wx.spire.com (not api.spire.com); check path and region.';
  }
  if (status === 403) {
    return 'Bundle may not be enabled for this token (e.g. maritime_atmos).';
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

/** One unified row for MapViewer: Spire + live WAQI on index 0 only. */
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
  /**
   * Beach/sun-relevant cloud cover (0–100%): `effective_cloud_cover` or weighted low/mid/high,
   * else `total_cloud_cover`. See `lib/spire-cloud-cover.ts`.
   */
  cloudCover: number;
  pop: number;
  /** Raw Spire `total_cloud_cover` (full column) when present — for debug / comparison. */
  spireCloudTotal?: number | null;
  /** Only with Spire `clouds` bundle (or future fields). */
  spireCloudLow?: number | null;
  spireCloudMid?: number | null;
  spireCloudHigh?: number | null;
  /** Base of lowest cloud layer with >50% cover (m AGL) — `clouds` bundle / OPF. */
  cloudCeiling?: number | null;
  /** J/kg — `thunderstorm` bundle. */
  cape?: number | null;
  /** kg/m² — `thunderstorm` bundle. */
  pwat?: number | null;
  /** J/kg — `thunderstorm` bundle. */
  dcape?: number | null;
  /** J/kg (≤ 0) — convective inhibition; `thunderstorm` / profile bundle when present. */
  cin?: number | null;
  /** Index 0 only + WAQI when ok */
  station?: string | null;
  /**
   * Hourly from Supabase `sammi_forecast` (same `time` ↔ `valid_time_utc`) — empty if cron has not run yet
   * or `location_id` does not match. `kans_*` = NULL when SQL `reliability = low`.
   */
  sammi?: {
    kansRegenPctSammi: number | null;
    kansOnweerPctSammi: number | null;
    kansMistPctSammi: number | null;
    reliability: 'high' | 'medium' | 'low';
    /** From `sammi_forecast` view (CAPE+PWAT+CIN / DCAPE guide) */
    tropicalTier?: string | null;
    windTier?: string | null;
    convectiveLine?: string | null;
    /** J/kg — same column as `row.cin` when Spire omits thunder bundle on this row. */
    cinJkg?: number | null;
    /** m AGL — cloud base / ceiling for “beach sky” copy; optional duplicate of `cloudCeiling`. */
    ceilingM?: number | null;
  };
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

  const cloudIn = extractSpireCloudLayerInputs(vr);
  const cloudCover = computeSpireBeachSkyCloudCover(cloudIn);
  const totalRaw =
    pickFirstNumber(vr, ['total_cloud_cover', 'cloud_cover']) ?? null;

  const cloudCeiling =
    pickFirstNumber(vr, [
      'cloud_ceiling',
      'ceiling_height',
      'height_of_cloud_base_above_ground_level',
      'cloud_base_height',
    ]) ?? null;

  const cape =
    pickFirstNumber(vr, [
      'cape',
      'CAPE',
      'convective_available_potential_energy',
    ]) ?? null;

  const pwat =
    pickFirstNumber(vr, [
      'precipitable_water',
      'precipitable_water_entire_atmosphere',
      'total_column_integrated_water_vapour',
      'tcw',
    ]) ?? null;

  const dcape =
    pickFirstNumber(vr, [
      'downdraft_cape',
      'downdraft_CAPE',
      'dcape',
    ]) ?? null;

  const cin =
    pickFirstNumber(vr, [
      'convective_inhibition',
      'cin',
      'CIN',
    ]) ?? null;

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
    cloudCover,
    spireCloudTotal: totalRaw,
    spireCloudLow: cloudIn.lowCloudCover,
    spireCloudMid: cloudIn.midCloudCover,
    spireCloudHigh: cloudIn.highCloudCover,
    cloudCeiling,
    cape,
    pwat,
    dcape,
    cin,
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

/** OpenUV `/forecast` — nested arrays with `{ uv, uv_time }`. */
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

/** UTC hour bucket (ms since epoch) → lookup key for Spire `valid_time` vs OpenUV `uv_time`. */
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
 * Raw Spire `data[]` + WAQI JSON. Index 0 gets live smog (AQI/PM2.5);
 * other hours: Spire values, `aqi`/`aqiStatus` null.
 *
 * UV: OpenUV **hourly forecast** (`/forecast`) is matched per `valid_time` so every hour
 * has an index. Then: Spire `uv_index` when present; else on index 0 no separate OpenUV `/uv` call.
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

/**
 * `maritime-atmos` = 50 m wind + maritime fields; `solar` is not allowed on many tokens.
 * `clouds` (low/mid/high) — see `lib/spire-cloud-cover.ts` — only if your Spire plan allows `clouds`.
 */
export const FORECAST_BUNDLES_VACATION = 'basic,maritime-atmos';

/** Legacy: same shape without WAQI. */
export function mapSpireForecastPointData(raw: unknown): SamuiWeatherForecastRow[] {
  if (!raw || typeof raw !== 'object' || !('data' in raw)) return [];
  const { data } = raw as { data: unknown };
  if (!Array.isArray(data)) return [];
  return mergeSpireWithWaqi(data, null);
}

/** Stable sort key for Spire `valid_time` (merge hourly + 6-hourly series). */
function spireValidTimeKey(entry: unknown): string {
  const t = (entry as { times?: { valid_time?: string } })?.times?.valid_time;
  if (!t || typeof t !== 'string') return '';
  try {
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch {
    return t;
  }
}

/** Summary of one Spire `/forecast/point` `data[]` — e.g. for the debug endpoint. */
export function computeSpirePointDataStats(data: unknown): {
  rowCount: number;
  spanHours: number;
  firstValidTime: string | null;
  lastValidTime: string | null;
} {
  if (!Array.isArray(data)) {
    return { rowCount: 0, spanHours: 0, firstValidTime: null, lastValidTime: null };
  }
  let minT = Infinity;
  let maxT = -Infinity;
  let firstAtMin = '';
  let lastAtMax = '';
  for (const e of data) {
    const k = spireValidTimeKey(e);
    if (!k) continue;
    const t = new Date(k).getTime();
    if (Number.isNaN(t)) continue;
    if (t < minT) {
      minT = t;
      firstAtMin = k;
    }
    if (t > maxT) {
      maxT = t;
      lastAtMax = k;
    }
  }
  const spanHours =
    Number.isFinite(minT) && Number.isFinite(maxT) ? (maxT - minT) / 3600000 : 0;
  return {
    rowCount: data.length,
    spanHours,
    firstValidTime: firstAtMin || null,
    lastValidTime: lastAtMax || null,
  };
}

export type SpireForecastDebugQueryResult = {
  label: string;
  url: string;
  status: number;
  ok: boolean;
  stats: ReturnType<typeof computeSpirePointDataStats>;
  message?: string;
  meta?: unknown;
  /** Raw rows (truncated when `truncated`) */
  data?: unknown[];
  truncated?: boolean;
  totalDataRows?: number;
};

/**
 * One request per common parameter set — see what Spire **actually** returns
 * (before WAQI/OpenUV merge). Use `/api/spire/forecast-debug` in the browser.
 */
export async function fetchSpireForecastDebugPanel(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<{ lat: number; lon: number; generatedAt: string; queries: SpireForecastDebugQueryResult[] }> {
  const token = getSpireApiToken();
  if (!token) {
    throw new Error('SPIRE_API_TOKEN is missing');
  }

  const MAX_DEBUG_ROWS = 400;
  const perFetchMs = 15000;

  const specs: {
    label: string;
    bundles: string;
    timeBundle?: string;
    forecastHours?: number;
  }[] = [
    {
      label: 'hourly + forecast_hours=360 (vacation bundles)',
      bundles: FORECAST_BUNDLES_VACATION,
      timeBundle: 'hourly',
      forecastHours: 360,
    },
    {
      label: 'hourly, no forecast_hours (vacation)',
      bundles: FORECAST_BUNDLES_VACATION,
      timeBundle: 'hourly',
    },
    {
      label: 'hourly_6day (vacation)',
      bundles: FORECAST_BUNDLES_VACATION,
      timeBundle: 'hourly_6day',
    },
    {
      label: 'medium_range_std_freq + forecast_hours=360 (vacation)',
      bundles: FORECAST_BUNDLES_VACATION,
      timeBundle: 'medium_range_std_freq',
      forecastHours: 360,
    },
    {
      label: 'medium_range_high_freq + forecast_hours=360 (vacation)',
      bundles: FORECAST_BUNDLES_VACATION,
      timeBundle: 'medium_range_high_freq',
      forecastHours: 360,
    },
    {
      label: 'all + forecast_hours=360 (basic)',
      bundles: 'basic',
      timeBundle: 'all',
      forecastHours: 360,
    },
    {
      label: '6_hourly + forecast_hours=360 (vacation)',
      bundles: FORECAST_BUNDLES_VACATION,
      timeBundle: '6_hourly',
      forecastHours: 360,
    },
    {
      label: 'no time_bundle (vacation — API default)',
      bundles: FORECAST_BUNDLES_VACATION,
    },
  ];

  const runOne = async (spec: (typeof specs)[number]): Promise<SpireForecastDebugQueryResult> => {
    const url = buildForecastPointUrl(lat, lon, spec.bundles, {
      timeBundle: spec.timeBundle,
      forecastHours: spec.forecastHours,
    });
    try {
      const r = await fetch(url, {
        headers: { 'spire-api-key': token },
        signal: combinedSignal(signal, perFetchMs),
        cache: 'no-store',
      });
      const json = (await r.json().catch(() => ({}))) as {
        data?: unknown[];
        meta?: unknown;
        message?: string;
        error?: string;
      };
      const raw = Array.isArray(json.data) ? json.data : [];
      const stats = computeSpirePointDataStats(raw);
      const truncated = raw.length > MAX_DEBUG_ROWS;
      const data = truncated ? raw.slice(0, MAX_DEBUG_ROWS) : raw;
      return {
        label: spec.label,
        url,
        status: r.status,
        ok: r.ok,
        stats,
        message:
          (typeof json.message === 'string' && json.message) ||
          (typeof json.error === 'string' && json.error) ||
          undefined,
        meta: json.meta,
        data,
        truncated: truncated || undefined,
        totalDataRows: raw.length,
      };
    } catch (e) {
      return {
        label: spec.label,
        url,
        status: 0,
        ok: false,
        stats: computeSpirePointDataStats([]),
        message: e instanceof Error ? e.message : String(e),
      };
    }
  };

  const queries = await Promise.all(specs.map(runOne));

  return {
    lat,
    lon,
    generatedAt: new Date().toISOString(),
    queries,
  };
}

/**
 * Spire contract (ProSeaDure): 0–48h hourly, 48–120h 3-hourly, 120–360h 6-hourly.
 * Same `valid_time` → highest `tierPriority` wins (hourly > 3_hourly > 6_hourly).
 *
 * Lower value = first in merge map; same `valid_time` → higher `p` wins.
 * `6_hourly_15day`: Spire ProSea — ~15d spine on a 6-hourly grid (per support).
 * `medium_range` / `6_hourly`: fallback when `6_hourly_15day` is not available.
 */
const SPIRE_CONTRACT_TIER_PRIORITY: Record<string, number> = {
  medium_range: 0,
  extended_15d: 0,
  '6_hourly_15day': 1,
  '6_hourly': 1,
  '3_hourly': 2,
  hourly: 3,
};

function mergeSpireContractTiers(layers: { tier: string; data: unknown[] }[]): unknown[] {
  const sorted = [...layers].sort(
    (a, b) =>
      (SPIRE_CONTRACT_TIER_PRIORITY[a.tier] ?? 0) - (SPIRE_CONTRACT_TIER_PRIORITY[b.tier] ?? 0),
  );
  const map = new Map<string, { entry: unknown; p: number }>();
  for (const { tier, data } of sorted) {
    const p = SPIRE_CONTRACT_TIER_PRIORITY[tier] ?? 0;
    for (const e of data) {
      const k = spireValidTimeKey(e);
      if (!k) continue;
      const cur = map.get(k);
      if (!cur || p >= cur.p) map.set(k, { entry: e, p });
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => v.entry);
}

function normalizeProbPercent(x: number): number {
  if (x >= 0 && x <= 1) return Math.round(x * 10000) / 100;
  return Math.min(100, Math.max(0, Math.round(x * 100) / 100));
}

function extractOpfProbsFromValues(v: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  const pop = pickFirstNumber(v, [
    'probability_of_precipitation_1hr',
    'probability_of_precipitation',
    'pop',
  ]);
  if (pop != null) out.probability_of_precipitation_1hr = normalizeProbPercent(pop);
  const p24 = pickFirstNumber(v, ['probability_of_precipitation_24hr']);
  if (p24 != null) out.probability_of_precipitation_24hr = normalizeProbPercent(p24);
  const th = pickFirstNumber(v, ['probability_of_thunderstorm']);
  if (th != null) out.probability_of_thunderstorm = normalizeProbPercent(th);
  const fg = pickFirstNumber(v, ['probability_of_fog', 'fog_probability']);
  if (fg != null) out.probability_of_fog = normalizeProbPercent(fg);
  return out;
}

/** Merge OPF hourly probabilities onto standard Point rows (same `spireValidTimeKey`). */
function overlayOpfProbabilitiesOnRows(base: unknown[], opf: unknown[]): void {
  if (!Array.isArray(opf) || opf.length === 0) return;
  const map = new Map<string, Record<string, number>>();
  for (const e of opf) {
    const k = spireValidTimeKey(e);
    if (!k) continue;
    const vals = (e as { values?: unknown }).values;
    if (!vals || typeof vals !== 'object') continue;
    const probs = extractOpfProbsFromValues(vals as Record<string, unknown>);
    if (Object.keys(probs).length === 0) continue;
    map.set(k, probs);
  }
  let n = 0;
  for (const e of base) {
    const k = spireValidTimeKey(e);
    if (!k) continue;
    const probs = map.get(k);
    if (!probs) continue;
    const row = e as { values?: Record<string, number | undefined> };
    row.values = { ...row.values, ...probs };
    n++;
  }
  if (n > 0) console.info(`[Spire] OPF probabilities merged on ${n} timesteps`);
}

/**
 * Spire + WAQI: combined Point `hourly,3_hourly,6_hourly_15day` or tier merge; parallel OPF (~72h,
 * bundles `basic,thunderstorm` then `basic`) overwrites probabilities only on the Samui point
 * ({@link isSamuiOpfOverlayPoint}). Sammi reliability in SQL: high ≤48h, medium ≤120h, low >120h
 * vs `issuance_time_utc` (`sammi_forecast` view).
 */
export async function getForecastMergedAt(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<SamuiWeatherForecastRow[]> {
  const token = getSpireApiToken();
  if (!token) {
    throw new Error('SPIRE_API_TOKEN is missing');
  }

  const waqiToken = (process.env.WAQI_API_TOKEN || process.env.NEXT_PUBLIC_AQICN_TOKEN)?.trim();
  const uvKey = process.env.NEXT_PUBLIC_OPENUV_API_KEY?.trim();

  const spireFetchSignal = () => combinedSignal(signal, 25000);

  const pointOptions = () => {
    const product = process.env.SPIRE_FORECAST_PRODUCT?.trim();
    const unitSystem = process.env.SPIRE_FORECAST_UNIT_SYSTEM?.trim();
    return {
      product: product || undefined,
      unitSystem: unitSystem || undefined,
    };
  };

  const fetchContractTier = async (
    timeBundle: string,
    forecastHours: number,
    bundles: string,
  ): Promise<unknown[]> => {
    const url = buildForecastPointUrl(lat, lon, bundles, {
      timeBundle,
      forecastHours,
      ...pointOptions(),
    });
    try {
      const r = await fetch(url, {
        headers: { 'spire-api-key': token },
        signal: spireFetchSignal(),
        next: { revalidate: 900 },
      });
      const json = (await r.json().catch(() => ({}))) as { data?: unknown[] };
      if (!r.ok) return [];
      return Array.isArray(json.data) ? json.data : [];
    } catch {
      return [];
    }
  };

  const bundleChain = (): string[] => {
    const envB = process.env.SPIRE_FORECAST_BUNDLES?.trim();
    const chain = [
      envB,
      'basic,maritime-atmos,clouds,thunderstorm',
      FORECAST_BUNDLES_VACATION,
      'basic',
    ].filter((b): b is string => Boolean(b));
    return [...new Set(chain)];
  };

  const tryFetchFirstBundle = async (
    timeBundle: string,
    forecastHours: number,
  ): Promise<unknown[]> => {
    for (const bundles of bundleChain()) {
      const data = await fetchContractTier(timeBundle, forecastHours, bundles);
      if (data.length > 0) return data;
    }
    return [];
  };

  const fetchSpireContractMerged = async (): Promise<unknown[]> => {
    const combined = await tryFetchFirstBundle('hourly,3_hourly,6_hourly_15day', 360);
    if (combined.length > 0) {
      const st = computeSpirePointDataStats(combined);
      if (st.spanHours >= 200) return combined;
    }

    const longFh = 360;
    let longTier = '6_hourly_15day';
    let longData = await tryFetchFirstBundle('6_hourly_15day', longFh);
    if (longData.length === 0) {
      longData = await tryFetchFirstBundle('6_hourly', longFh);
      longTier = '6_hourly';
    }
    if (longData.length === 0) {
      longData = await tryFetchFirstBundle('medium_range_std_freq', longFh);
      longTier = 'medium_range';
    }

    const layers: { tier: string; data: unknown[] }[] = [{ tier: longTier, data: longData }];
    layers.push({ tier: '3_hourly', data: await tryFetchFirstBundle('3_hourly', 120) });
    layers.push({ tier: 'hourly', data: await tryFetchFirstBundle('hourly', 48) });
    return mergeSpireContractTiers(layers);
  };

  /**
   * WAQI + OpenUV are optional polish; abort after 4s so they never block Spire merge.
   * OpenUV `/forecast` alone supplies hourly UV (no separate `/uv` call).
   */
  const AUX_MS = 4000;
  const auxSig = () => combinedSignal(signal, AUX_MS);

  const fetchWaqi = (): Promise<unknown> => {
    if (!waqiToken) return Promise.resolve(null);
    const url = `https://api.waqi.info/feed/geo:${lat};${lon}/?token=${encodeURIComponent(waqiToken)}`;
    return fetch(url, { signal: auxSig(), next: { revalidate: 60 } })
      .then((r) => (r.ok ? r.json() : null))
      .catch((e) => {
        console.error('Spire merge fetchWaqi err:', e);
        return null;
      });
  };

  /** Hourly UV per `uv_time` — needed because Spire often omits per-hour `uv_index`. */
  const fetchUvForecast = (): Promise<unknown> => {
    if (!uvKey) return Promise.resolve(null);
    const url = `https://api.openuv.io/api/v1/forecast?lat=${lat}&lng=${lon}&alt=0`;
    return fetch(url, {
      headers: { 'x-access-token': uvKey },
      signal: auxSig(),
      next: { revalidate: 60 },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch((e) => {
        console.error('Spire merge fetchUvForecast err:', e);
        return null;
      });
  };

  const opfPromise = isSamuiOpfOverlayPoint(lat, lon)
    ? fetchOpfProbabilities(token, spireFetchSignal, pointOptions).catch(() => [] as unknown[])
    : Promise.resolve([] as unknown[]);

  const [rows, waqiJson, uvForecastJson, opfRows] = await Promise.all([
    fetchSpireContractMerged().catch((e) => {
      console.error('Spire contract merge err:', e);
      return [] as unknown[];
    }),
    fetchWaqi(),
    fetchUvForecast(),
    opfPromise,
  ]);

  if (rows.length === 0) {
    throw new Error('Spire: no forecast data (contract tiers)');
  }

  overlayOpfProbabilitiesOnRows(rows, opfRows);

  // Filter historical data out, only keep from the current hour forward
  const nowMs = Date.now();
  const currentHourMs = nowMs - (nowMs % (60 * 60 * 1000));

  const filtered = rows.filter((row: any) => {
    const vt = row?.times?.valid_time;
    if (!vt) return true;
    return new Date(vt).getTime() >= currentHourMs;
  });

  return mergeSpireWithWaqi(filtered, waqiJson, undefined, uvForecastJson);
}

/** Koh Samui dashboard default. */
export async function getSamuiForecastMerged(
  signal?: AbortSignal,
): Promise<SamuiWeatherForecastRow[]> {
  return getForecastMergedAt(SAMUI_CENTER.lat, SAMUI_CENTER.lon, signal);
}

/** Krabi coast (Baan Mook Taley) — same SPIRE merge as Samui, different lat/lon. */
export async function getKrabiForecastMerged(
  signal?: AbortSignal,
): Promise<SamuiWeatherForecastRow[]> {
  return getForecastMergedAt(KRABI_FORECAST_POINT.lat, KRABI_FORECAST_POINT.lon, signal);
}
