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
): string {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    bundles,
  });
  return `${SPIRE_API_BASE}/forecast/point?${params.toString()}`;
}

export function buildTidesPointUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  return `${SPIRE_API_BASE}/forecast/point/tides?${params.toString()}`;
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

export function convertSpireValue(
  value: number,
  type: 'temp' | 'wind',
): number {
  if (type === 'temp') {
    return Math.round(value - 273.15);
  }
  if (type === 'wind') {
    return parseFloat((value * 1.94384).toFixed(1));
  }
  return value;
}

/** Eén uniforme rij voor MapViewer: Spire + live WAQI alleen op index 0. */
export interface SamuiWeatherForecastRow {
  time: string;
  temp: number;
  windSpeed: number;
  windGust: number;
  windDir: number;
  precip: number;
  humidity: number;
  precipRate: number;
  uvIndex: number | null;
  pm25: number | null;
  aqi: number | null;
  aqiStatus: string | null;
  /** Alleen index 0 + WAQI ok */
  station?: string | null;
}

export function getAQIDescription(aqi: number | undefined | null): string {
  if (aqi == null || Number.isNaN(aqi)) return 'Onbekend';
  if (aqi <= 50) return 'Goed';
  if (aqi <= 100) return 'Matig';
  if (aqi <= 150) return 'Ongezond (haze)';
  if (aqi <= 200) return 'Ongezond';
  return 'Zeer ongezond';
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

  return {
    time: e.times?.valid_time ?? new Date().toISOString(),
    temp: convertSpireValue(Number(v.air_temperature ?? 293.15), 'temp'),
    windSpeed: convertSpireValue(Number(v.wind_speed ?? 0), 'wind'),
    windGust: convertSpireValue(Number(v.wind_gust ?? 0), 'wind'),
    windDir: Number(v.wind_direction ?? 0),
    precip: Number(v.precipitation_amount ?? 0),
    humidity: Number(v.relative_humidity ?? 0),
    precipRate: Number(v.precipitation_rate ?? 0),
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

/**
 * Ruwe Spire `data[]` + WAQI JSON. Index 0 krijgt live smog (AQI/PM2.5);
 * andere uren: Spire-waarden, `aqi`/`aqiStatus` null.
 */
export function mergeSpireWithWaqi(
  spireRows: unknown[],
  waqiData: unknown,
): SamuiWeatherForecastRow[] {
  const waqi = waqiData as WaqiPayload | null;
  const waqiOk =
    waqi != null &&
    typeof waqi === 'object' &&
    waqi.status === 'ok' &&
    waqi.data != null;

  return spireRows.map((row, index) => {
    const base = mapSpirePointRow(row);
    const isNow = index === 0;

    if (isNow && waqiOk && waqi!.data) {
      const d = waqi!.data;
      const pm =
        typeof d.iaqi?.pm25?.v === 'number' ? d.iaqi.pm25.v : base.pm25;
      const aqiVal = typeof d.aqi === 'number' ? d.aqi : null;

      return {
        ...base,
        pm25: pm,
        aqi: aqiVal,
        aqiStatus: getAQIDescription(d.aqi ?? undefined),
        station: d.city?.name ?? null,
      };
    }

    return {
      ...base,
      aqi: null,
      aqiStatus: null,
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
 * Parallel Spire (+ bundle-fallback) + WAQI; één array voor de frontend.
 */
export async function getSamuiForecastMerged(): Promise<
  SamuiWeatherForecastRow[]
> {
  const token = getSpireApiToken();
  if (!token) {
    throw new Error('SPIRE_API_TOKEN ontbreekt');
  }

  const waqiToken = process.env.WAQI_API_TOKEN?.trim();

  const fetchSpire = async (): Promise<{ data?: unknown[] }> => {
    for (const bundles of [
      FORECAST_BUNDLES_VACATION,
      'basic,maritime_atmos',
      'basic',
    ] as const) {
      const url = buildForecastPointUrl(
        SAMUI_CENTER.lat,
        SAMUI_CENTER.lon,
        bundles,
      );
      const r = await fetch(url, {
        headers: { 'spire-api-key': token },
        next: { revalidate: 900 },
      });
      if (r.ok) return (await r.json()) as { data?: unknown[] };
      if (r.status !== 403) {
        throw new Error(`Spire HTTP ${r.status}`);
      }
    }
    throw new Error('Spire 403');
  };

  const fetchWaqi = (): Promise<unknown> => {
    if (!waqiToken) return Promise.resolve(null);
    const url = `https://api.waqi.info/feed/geo:${SAMUI_CENTER.lat};${SAMUI_CENTER.lon}/?token=${encodeURIComponent(waqiToken)}`;
    return fetch(url, { next: { revalidate: 900 } }).then((r) =>
      r.ok ? r.json() : null,
    );
  };

  const [spireJson, waqiJson] = await Promise.all([fetchSpire(), fetchWaqi()]);

  const rows = Array.isArray(spireJson?.data) ? spireJson.data : [];
  return mergeSpireWithWaqi(rows, waqiJson);
}
