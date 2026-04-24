import { NextResponse } from 'next/server';
import {
  SAMUI_CENTER,
  buildForecastPointUrl,
  getSpireApiToken,
  spireGetJson,
} from '../../../lib/spire';

/** Quick health check; prefer GET /api/spire/forecast-point for real integration tests. */
export async function GET() {
  const token = getSpireApiToken();
  if (!token) {
    return NextResponse.json(
      { status: 'Error', message: 'SPIRE_API_TOKEN is missing' },
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
          message: 'Spire refused the connection',
          details: data,
          hint,
        },
        { status },
      );
    }

    const payload = data as { data?: unknown[] };
    return NextResponse.json({
      status: 'OK',
      message: 'Connected to Spire Global',
      sampleData: Array.isArray(payload.data) ? payload.data[0] : undefined,
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
