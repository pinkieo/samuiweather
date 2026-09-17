/**
 * Spire 10 m wind grid via Theyr RouteData (same path as VIP).
 * Picture only — not Sammi / dashboard numbers. Do not loop Spire /forecast/point.
 */

export const SPIRE_RDAS_FEED = 'bd131aaa-2e1f-49be-9add-cfa0498781de';
export const RDAS_URL = 'https://rdas.theyr.com/v2.3/RouteData';
export const LICENSE_AUTH_URL = 'https://auth.theyr.com/v1.3/License';

/** Gulf of Thailand box covering Koh Samui and Krabi. */
export const OVERLAY_NORTH = 11.5;
export const OVERLAY_SOUTH = 8.0;
export const OVERLAY_WEST = 98.5;
export const OVERLAY_EAST = 101.5;
export const OVERLAY_STEP_DEG = 0.25;
export const MAX_ROUTEDATA_POINTS = 4096;
export const KN_TO_MS = 0.514444;

const FILTER_EXCLUDE_NON_WIND = [
  'wave',
  'stdmet',
  'iceFraction',
  'sss',
  'sst',
  'seaFloorDepth',
  'oceanCurrent',
  'tide',
  'airTemperature',
] as const;

type TokenCache = { accessToken: string; expiresAtMs: number };
let tokenCache: TokenCache | null = null;

export function alignRdasHour(at: Date): Date {
  const utc = new Date(Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate(),
    at.getUTCHours(),
    0,
    0,
    0,
  ));
  let hour = Math.round(utc.getUTCHours() / 3) * 3;
  if (hour === 24) hour = 0;
  utc.setUTCHours(hour);
  return utc;
}

export function validTimeIsoZ(at: Date): string {
  const aligned = alignRdasHour(at);
  return aligned.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function arange(start: number, stop: number, step: number): number[] {
  if (!(step > 0)) return [];
  const n = Math.floor((stop - start) / step + 1e-9) + 1;
  const out: number[] = [];
  for (let i = 0; i < Math.max(n, 0); i++) {
    out.push(Number((start + i * step).toFixed(6)));
  }
  return out;
}

/** North-first latitudes (MapLibre image row 0 = north). */
export function overlayAxes(): { lats: number[]; lons: number[] } {
  const southToNorth = arange(OVERLAY_SOUTH, OVERLAY_NORTH, OVERLAY_STEP_DEG);
  const lats = southToNorth.slice().reverse();
  const lons = arange(OVERLAY_WEST, OVERLAY_EAST, OVERLAY_STEP_DEG);
  return { lats, lons };
}

export function routedataBody(
  points: Array<{ lat: number; lon: number; t: string }>,
  feed = SPIRE_RDAS_FEED,
): Record<string, unknown> {
  return {
    points,
    options: {
      units: { direction: 'degree', speed: 'kn', height: 'meter' },
      filter: [...FILTER_EXCLUDE_NON_WIND],
      dataFeed: { id: feed, options: null },
    },
  };
}

/** Meteorological FROM (°) + speed (kn) → eastward u, northward v (m/s). */
export function windUvMs(speedKn: number, fromDeg: number): { u: number; v: number } {
  const ms = speedKn * KN_TO_MS;
  const rad = (fromDeg * Math.PI) / 180;
  return { u: -ms * Math.sin(rad), v: -ms * Math.cos(rad) };
}

type RoutePoint = {
  lat?: unknown;
  lon?: unknown;
  data?: { wind?: { modelRunDate?: unknown; values?: Array<Record<string, unknown>> } };
};

export type ExtractedWind = {
  u: Array<number | null>;
  v: Array<number | null>;
  usable: number;
  missing: number;
  modelRun: string | null;
};

export function extractWindUv(
  payload: { dataPoints?: unknown },
  lats: number[],
  lons: number[],
): ExtractedWind {
  const dataPoints = Array.isArray(payload.dataPoints) ? payload.dataPoints : [];
  const byCoord = new Map<string, RoutePoint>();
  for (const item of dataPoints) {
    if (!item || typeof item !== 'object') continue;
    const pt = item as RoutePoint;
    const lat = Number(pt.lat);
    const lon = Number(pt.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    byCoord.set(`${lat.toFixed(6)},${lon.toFixed(6)}`, pt);
  }
  const u = new Array<number | null>(lats.length * lons.length).fill(null);
  const v = new Array<number | null>(lats.length * lons.length).fill(null);
  let usable = 0;
  let missing = 0;
  const runs: string[] = [];
  for (let i = 0; i < lats.length; i++) {
    for (let j = 0; j < lons.length; j++) {
      const key = `${Number(lats[i]).toFixed(6)},${Number(lons[j]).toFixed(6)}`;
      const item = byCoord.get(key);
      const wind = item?.data?.wind;
      const first = Array.isArray(wind?.values) ? wind.values[0] : undefined;
      const speed = Number(first?.speed);
      const direction = Number(first?.direction);
      const idx = i * lons.length + j;
      if (!Number.isFinite(speed) || !Number.isFinite(direction)) {
        missing += 1;
        continue;
      }
      const uv = windUvMs(speed, direction);
      u[idx] = uv.u;
      v[idx] = uv.v;
      usable += 1;
      if (wind?.modelRunDate != null) runs.push(String(wind.modelRunDate));
    }
  }
  const counts = new Map<string, number>();
  for (const run of runs) counts.set(run, (counts.get(run) || 0) + 1);
  let modelRun: string | null = null;
  let best = 0;
  for (const [run, n] of counts) {
    if (n > best) {
      best = n;
      modelRun = run;
    }
  }
  return { u, v, usable, missing, modelRun };
}

function theyrLicenseKey(): string {
  return (
    process.env.THEYR_LICENSE_KEY?.trim() ||
    process.env.THEYR_LOGIN_KEY?.trim() ||
    ''
  );
}

function jwtExpiryMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = parts[1]!;
  const pad = '='.repeat((4 - (payload.length % 4)) % 4);
  try {
    const b64 = (payload + pad).replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as {
      exp?: number;
    };
    if (typeof json.exp !== 'number') return null;
    return json.exp * 1000;
  } catch {
    return null;
  }
}

export async function getTheyrAccessToken(force = false): Promise<string> {
  const now = Date.now();
  if (!force && tokenCache && tokenCache.expiresAtMs - 60_000 > now) {
    return tokenCache.accessToken;
  }
  const key = theyrLicenseKey();
  if (!key) throw new Error('THEYR_LICENSE_KEY is not configured');
  const res = await fetch(LICENSE_AUTH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Samui-RDAS-wind/1.0',
    },
    body: JSON.stringify({ key }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Theyr license API HTTP ${res.status}`);
  const payload = (await res.json()) as { access_token?: string; accessToken?: string } | string;
  const token =
    typeof payload === 'string'
      ? payload.trim()
      : String(payload.access_token || payload.accessToken || '').trim();
  if (!token) throw new Error('Theyr license API did not return access_token');
  const exp = jwtExpiryMs(token) ?? now + 8 * 3600_000;
  tokenCache = { accessToken: token, expiresAtMs: exp };
  return token;
}

export async function postRouteData(
  points: Array<{ lat: number; lon: number; t: string }>,
  token: string,
  feed = SPIRE_RDAS_FEED,
): Promise<{ dataPoints?: unknown }> {
  if (points.length > MAX_ROUTEDATA_POINTS) {
    throw new Error(`RouteData has ${points.length} points; max is ${MAX_ROUTEDATA_POINTS}`);
  }
  const res = await fetch(RDAS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Samui-RDAS-wind/1.0',
    },
    body: JSON.stringify(routedataBody(points, feed)),
    cache: 'no-store',
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`RouteData HTTP ${res.status}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('RouteData response was not JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('RouteData JSON was not an object');
  return parsed as { dataPoints?: unknown };
}

export type SpireWindField = {
  source_label: 'Spire';
  units: 'm s**-1';
  width: number;
  height: number;
  west: number;
  south: number;
  east: number;
  north: number;
  u: Array<number | null>;
  v: Array<number | null>;
  validTime: string;
  meteo_source: 'spire';
  delivery: 'theyr_rdas';
  datafeed_id: string;
  issuance_time_utc: string | null;
};

export async function fetchSpireWindField(now = new Date()): Promise<SpireWindField> {
  const { lats, lons } = overlayAxes();
  const isoT = validTimeIsoZ(now);
  const points = lats.flatMap((lat) => lons.map((lon) => ({ lat, lon, t: isoT })));
  let token = await getTheyrAccessToken();
  let payload: { dataPoints?: unknown };
  try {
    payload = await postRouteData(points, token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (!msg.includes('HTTP 401')) throw err;
    token = await getTheyrAccessToken(true);
    payload = await postRouteData(points, token);
  }
  const extracted = extractWindUv(payload, lats, lons);
  if (extracted.usable <= 0) throw new Error('RouteData returned no usable wind values');
  return {
    source_label: 'Spire',
    units: 'm s**-1',
    width: lons.length,
    height: lats.length,
    west: lons[0]!,
    south: lats[lats.length - 1]!,
    east: lons[lons.length - 1]!,
    north: lats[0]!,
    u: extracted.u,
    v: extracted.v,
    validTime: isoT,
    meteo_source: 'spire',
    delivery: 'theyr_rdas',
    datafeed_id: SPIRE_RDAS_FEED,
    issuance_time_utc: extracted.modelRun,
  };
}
