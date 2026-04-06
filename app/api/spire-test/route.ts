import { NextResponse } from 'next/server';
import {
  SAMUI_CENTER,
  buildForecastPointUrl,
  getSpireApiToken,
  spireGetJson,
} from '../../../lib/spire';

/** Snelle healthcheck; nieuwe integratie: gebruik GET /api/spire/forecast-point */
export async function GET() {
  const token = getSpireApiToken();
  if (!token) {
    return NextResponse.json(
      { status: 'Error', message: 'SPIRE_API_TOKEN ontbreekt' },
      { status: 500 },
    );
  }

  const { lat, lon } = SAMUI_CENTER;
  const url = buildForecastPointUrl(lat, lon, 'basic');

  try {
    const { ok, status, data, hint } = await spireGetJson(url, token);

    if (!ok) {
      return NextResponse.json(
        {
          status: 'Error',
          message: 'Spire weigert de verbinding',
          details: data,
          hint,
        },
        { status },
      );
    }

    const payload = data as { data?: unknown[] };
    return NextResponse.json({
      status: 'Succes!',
      message: 'Verbonden met Spire Global',
      sampleData: Array.isArray(payload.data) ? payload.data[0] : undefined,
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
