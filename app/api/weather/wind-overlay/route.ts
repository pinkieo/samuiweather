import { NextResponse } from 'next/server';
import type { WindOverlayField } from '@/lib/wind-overlay';
import { fetchSpireWindField, overlayAxes } from '@/lib/theyr-rdas-wind';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

const CACHE_MS = 20 * 60 * 1000;
const ICON_TIMEOUT_MS = 8000;

type CacheEntry = { at: number; field: WindOverlayField };
let cache: CacheEntry | null = null;

type OmHourly = {
  time: string[];
  pressure_msl?: Array<number | null>;
  shortwave_radiation?: Array<number | null>;
};

type OmBlock = {
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

/** ICON MSLP / sunshine only. Wind comes from Theyr Spire. Failures are ignored. */
async function iconPressureAndSun(
  width: number,
  height: number,
): Promise<{ p: Array<number | null>; sw: Array<number | null> } | null> {
  const { lats, lons } = overlayAxes();
  if (lats.length !== height || lons.length !== width) return null;
  const points: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < lats.length; i++) {
    for (let j = 0; j < lons.length; j++) {
      points.push({ lat: lats[i]!, lon: lons[j]! });
    }
  }
  const CHUNK = 80;
  const p = new Array<number | null>(width * height).fill(null);
  const sw = new Array<number | null>(width * height).fill(null);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ICON_TIMEOUT_MS);
  try {
    for (let start = 0; start < points.length; start += CHUNK) {
      const slice = points.slice(start, start + CHUNK);
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', slice.map((pt) => pt.lat).join(','));
      url.searchParams.set('longitude', slice.map((pt) => pt.lon).join(','));
      url.searchParams.set('hourly', 'pressure_msl,shortwave_radiation');
      url.searchParams.set('models', 'icon_seamless');
      url.searchParams.set('forecast_days', '1');
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) return null;
      const json = (await res.json()) as OmBlock | OmBlock[];
      const blocks = Array.isArray(json) ? json : [json];
      for (let k = 0; k < slice.length; k++) {
        const hourly = blocks[k]?.hourly;
        if (!hourly) continue;
        const hi = pickHour(hourly);
        const idx = start + k;
        const pp = hourly.pressure_msl?.[hi];
        const ss = hourly.shortwave_radiation?.[hi];
        p[idx] = typeof pp === 'number' && Number.isFinite(pp) ? pp : null;
        sw[idx] = typeof ss === 'number' && Number.isFinite(ss) ? ss : null;
      }
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  return { p, sw };
}

async function buildField(): Promise<WindOverlayField> {
  const wind = await fetchSpireWindField();
  const extras = await iconPressureAndSun(wind.width, wind.height);
  return {
    ...wind,
    ...(extras ?? {}),
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
