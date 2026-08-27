import { NextResponse } from 'next/server';
import {
  buildForecastPointUrl,
  getSpireApiToken,
  mapSpireForecastPointData,
  spireGetJson,
} from '@/lib/spire';
import type { SamuiWeatherForecastRow } from '@/lib/spire';
import {
  CACHE_CONTROL_NO_STORE,
  SAMUI_PLACE,
  isInVacationBbox,
} from '@/lib/weather-provenance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/**
 * SPIRE point forecast at a vacation-area lat/lon (POI Intelligence Cards).
 * GET /api/weather/point?lat=&lon=
 */
export async function GET(request: Request) {
  const token = getSpireApiToken();
  if (!token) {
    return NextResponse.json(
      { error: 'SPIRE_API_TOKEN missing' },
      { status: 500, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  }

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { error: 'lat and lon required' },
      { status: 400, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  }
  if (!isInVacationBbox(lat, lon)) {
    return NextResponse.json(
      {
        error: 'lat/lon is outside the Koh Samui vacation area',
        default_place: SAMUI_PLACE,
      },
      { status: 400, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  }

  const url = buildForecastPointUrl(lat, lon, 'basic,maritime_atmos');

  try {
    const { ok, status, data } = await spireGetJson(url, token);
    if (!ok) {
      return NextResponse.json(
        { error: 'Spire point forecast failed', details: data },
        { status, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
      );
    }

    const rows = mapSpireForecastPointData(data) as SamuiWeatherForecastRow[];
    const now = rows[0] ?? null;

    return NextResponse.json(
      {
        lat,
        lon,
        now,
        hours: rows.slice(0, 24),
      },
      { headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  }
}
