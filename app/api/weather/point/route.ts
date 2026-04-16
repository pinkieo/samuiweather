import { NextResponse } from 'next/server';
import {
  buildForecastPointUrl,
  getSpireApiToken,
  mapSpireForecastPointData,
  spireGetJson,
} from '@/lib/spire';
import type { SamuiWeatherForecastRow } from '@/lib/spire';

export const dynamic = 'force-dynamic';

/**
 * SPIRE point forecast at arbitrary lat/lon (POI Intelligence Cards).
 * GET /api/weather/point?lat=&lon=
 */
export async function GET(request: Request) {
  const token = getSpireApiToken();
  if (!token) {
    return NextResponse.json({ error: 'SPIRE_API_TOKEN missing' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'lat and lon required' }, { status: 400 });
  }

  const url = buildForecastPointUrl(lat, lon, 'basic,maritime_atmos');

  try {
    const { ok, status, data } = await spireGetJson(url, token);
    if (!ok) {
      return NextResponse.json(
        { error: 'Spire point forecast failed', details: data },
        { status },
      );
    }

    const rows = mapSpireForecastPointData(data) as SamuiWeatherForecastRow[];
    const now = rows[0] ?? null;

    return NextResponse.json({
      lat,
      lon,
      now,
      hours: rows.slice(0, 24),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
