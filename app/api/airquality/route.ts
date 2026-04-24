import { NextResponse } from 'next/server';
import { SAMUI_CENTER } from '@/lib/spire';

const TIMEOUT_MS = 5000;

export interface AirQualityData {
  aqi: number;
  pm25: number | null;
  pm10: number | null;
  station: string;
  dominantPol: string;
  updatedAt: string;
}

export const revalidate = 3600;

function parseLatLon(request: Request): { lat: number; lon: number } {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -55 &&
    lat <= 55 &&
    lon >= -180 &&
    lon <= 180
  ) {
    return { lat, lon };
  }
  return { lat: SAMUI_CENTER.lat, lon: SAMUI_CENTER.lon };
}

export async function GET(request: Request) {
  const token = process.env.NEXT_PUBLIC_AQICN_TOKEN;
  console.log('[airquality] token aanwezig:', !!token);

  if (!token) {
    console.error('[airquality] NEXT_PUBLIC_AQICN_TOKEN is missing in .env.local');
    return NextResponse.json({ error: 'NEXT_PUBLIC_AQICN_TOKEN is not set' }, { status: 500 });
  }

  const { lat, lon } = parseLatLon(request);
  const url = `https://api.waqi.info/feed/geo:${lat};${lon}/?token=${token}`;
  console.log('[airquality] fetch →', url.replace(token, 'TOKEN'));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 900 },
    });
    clearTimeout(timer);
    console.log('[airquality] HTTP status:', res.status);

    if (!res.ok) throw new Error(`AQICN HTTP ${res.status}`);

    const json = (await res.json()) as {
      status: string;
      data?: {
        aqi: number;
        dominentpol?: string;
        city?: { name?: string };
        time?: { s?: string };
        iaqi?: {
          pm25?: { v: number };
          pm10?: { v: number };
        };
      };
    };

    console.log('[airquality] AQICN status:', json.status, '| aqi:', json.data?.aqi);

    if (json.status !== 'ok' || !json.data) {
      throw new Error(`AQICN status: ${json.status}`);
    }

    const d = json.data;
    const result: AirQualityData = {
      aqi: d.aqi,
      pm25: d.iaqi?.pm25?.v ?? null,
      pm10: d.iaqi?.pm10?.v ?? null,
      station: d.city?.name ?? 'Koh Samui',
      dominantPol: d.dominentpol ?? '—',
      updatedAt: d.time?.s ?? '',
    };

    console.log('[airquality] ✓ retourneert:', result);
    return NextResponse.json(result);
  } catch (err) {
    clearTimeout(timer);
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'AQICN API timeout (>5s)'
          : err.message
        : 'Fetch fout';
    console.error('[airquality] fout:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
