import { NextResponse } from 'next/server';
import type { WindOverlayField } from '@/lib/wind-overlay';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

/** Koh Samui island box — DWD ICON 10 m U/V for the Windy-look picture overlay. */
const NORTH = 11.5;
const SOUTH = 8.0;
const WEST = 98.5;
const EAST = 101.5;
const STEP = 0.25;
const CHUNK = 80;
const CACHE_MS = 20 * 60 * 1000;

type CacheEntry = { at: number; field: WindOverlayField };
let cache: CacheEntry | null = null;

function grid(): { lats: number[]; lons: number[] } {
  const lats: number[] = [];
  const lons: number[] = [];
  for (let lat = NORTH; lat >= SOUTH - 1e-9; lat -= STEP) lats.push(Number(lat.toFixed(4)));
  for (let lon = WEST; lon <= EAST + 1e-9; lon += STEP) lons.push(Number(lon.toFixed(4)));
  return { lats, lons };
}

type OmHourly = {
  time: string[];
  wind_u_component_10m?: Array<number | null>;
  wind_v_component_10m?: Array<number | null>;
};

type OmBlock = {
  latitude: number;
  longitude: number;
  hourly?: OmHourly;
};

function pickHour(hourly: OmHourly, now = Date.now()): number {
  const times = hourly.time || [];
  let best = 0;
  let bestAbs = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i]!);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - now);
    if (d < bestAbs) {
      bestAbs = d;
      best = i;
    }
  }
  return best;
}

async function fetchChunk(points: Array<{ lat: number; lon: number }>): Promise<OmBlock[]> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', points.map((p) => p.lat).join(','));
  url.searchParams.set('longitude', points.map((p) => p.lon).join(','));
  url.searchParams.set('hourly', 'wind_u_component_10m,wind_v_component_10m');
  url.searchParams.set('models', 'icon_seamless');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('wind_speed_unit', 'ms');
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`ICON grid HTTP ${res.status}`);
  const json = (await res.json()) as OmBlock | OmBlock[];
  return Array.isArray(json) ? json : [json];
}

async function buildField(): Promise<WindOverlayField> {
  const { lats, lons } = grid();
  const points: Array<{ lat: number; lon: number; i: number; j: number }> = [];
  for (let i = 0; i < lats.length; i++) {
    for (let j = 0; j < lons.length; j++) {
      points.push({ lat: lats[i]!, lon: lons[j]!, i, j });
    }
  }
  const u = new Array<number | null>(lats.length * lons.length).fill(null);
  const v = new Array<number | null>(lats.length * lons.length).fill(null);
  let validTime: string | null = null;
  for (let start = 0; start < points.length; start += CHUNK) {
    const slice = points.slice(start, start + CHUNK);
    const blocks = await fetchChunk(slice);
    for (let k = 0; k < slice.length; k++) {
      const block = blocks[k];
      const pt = slice[k]!;
      const hourly = block?.hourly;
      if (!hourly?.wind_u_component_10m || !hourly.wind_v_component_10m) continue;
      const hi = pickHour(hourly);
      if (!validTime) validTime = hourly.time[hi] ?? null;
      const uu = hourly.wind_u_component_10m[hi];
      const vv = hourly.wind_v_component_10m[hi];
      const idx = pt.i * lons.length + pt.j;
      u[idx] = typeof uu === 'number' && Number.isFinite(uu) ? uu : null;
      v[idx] = typeof vv === 'number' && Number.isFinite(vv) ? vv : null;
    }
  }
  return {
    source_label: 'DWD ICON',
    units: 'm s**-1',
    width: lons.length,
    height: lats.length,
    west: lons[0]!,
    south: lats[lats.length - 1]!,
    east: lons[lons.length - 1]!,
    north: lats[0]!,
    u,
    v,
    validTime,
  };
}

export async function GET() {
  try {
    if (cache && Date.now() - cache.at < CACHE_MS) {
      return NextResponse.json(cache.field, { headers: { 'Cache-Control': 'no-store' } });
    }
    const field = await buildField();
    cache = { at: Date.now(), field };
    return NextResponse.json(field, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'wind overlay failed';
    console.error('[wind-overlay]', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
