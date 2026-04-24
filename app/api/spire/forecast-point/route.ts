import { NextResponse } from 'next/server';
import {
  SAMUI_CENTER,
  buildForecastPointUrl,
  getSpireApiToken,
  spireGetJson,
} from '../../../../lib/spire';

/**
 * Point Forecast (stabiel, 2023/2025 contract) — Samui Pro hoofdweergave.
 * GET /api/spire/forecast-point?lat=&lon=&bundles=basic
 */
export async function GET(request: Request) {
  const token = getSpireApiToken();
  if (!token) {
    return NextResponse.json(
      { status: 'Error', message: 'SPIRE_API_TOKEN is missing' },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat') ?? SAMUI_CENTER.lat);
  const lon = Number(searchParams.get('lon') ?? SAMUI_CENTER.lon);
  const bundles = searchParams.get('bundles') ?? 'basic';

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { status: 'Error', message: 'Ongeldige lat/lon' },
      { status: 400 },
    );
  }

  const url = buildForecastPointUrl(lat, lon, bundles);

  try {
    const { ok, status, data, hint } = await spireGetJson(url, token);

    if (!ok) {
      return NextResponse.json(
        {
          status: 'Error',
          message: 'Spire point forecast mislukt',
          details: data,
          hint,
        },
        { status },
      );
    }

    const payload = data as { data?: unknown[] };
    return NextResponse.json({
      status: 'OK',
      endpoint: 'forecast/point',
      bundles,
      lat,
      lon,
      sample: Array.isArray(payload.data) ? payload.data[0] : undefined,
      raw: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'Server Error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
