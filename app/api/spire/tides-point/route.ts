import { NextResponse } from 'next/server';
import {
  SAMUI_CENTER,
  buildTidesPointUrl,
  getSpireApiToken,
  spireGetJson,
} from '../../../../lib/spire';

/**
 * Tides Point API — getijden-widget (~5.000 requests/dag).
 * GET /api/spire/tides-point?lat=&lon=
 */
export async function GET(request: Request) {
  const token = getSpireApiToken();
  if (!token) {
    return NextResponse.json(
      { status: 'Error', message: 'SPIRE_API_TOKEN ontbreekt' },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat') ?? SAMUI_CENTER.lat);
  const lon = Number(searchParams.get('lon') ?? SAMUI_CENTER.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { status: 'Error', message: 'Ongeldige lat/lon' },
      { status: 400 },
    );
  }

  const url = buildTidesPointUrl(lat, lon);

  try {
    const { ok, status, data, hint } = await spireGetJson(url, token);

    if (!ok) {
      return NextResponse.json(
        {
          status: 'Error',
          message: 'Spire tides point mislukt',
          details: data,
          hint,
        },
        { status },
      );
    }

    return NextResponse.json({
      status: 'OK',
      endpoint: 'forecast/point/tides',
      lat,
      lon,
      raw: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'Server Error',
        error: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    );
  }
}
