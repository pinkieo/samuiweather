import { NextResponse } from 'next/server';
import { fetchSpireForecastDebugPanel, SAMUI_CENTER } from '@/lib/spire';

export const dynamic = 'force-dynamic';

function parseOptionalLatLon(request: Request): { lat: number; lon: number } {
  const { searchParams } = new URL(request.url);
  const latN = Number(searchParams.get('lat'));
  const lonN = Number(searchParams.get('lon'));
  if (
    Number.isFinite(latN) &&
    Number.isFinite(lonN) &&
    latN >= -55 &&
    latN <= 55 &&
    lonN >= -180 &&
    lonN <= 180
  ) {
    return { lat: latN, lon: lonN };
  }
  return { lat: SAMUI_CENTER.lat, lon: SAMUI_CENTER.lon };
}

/**
 * Ruwe Spire `/forecast/point` payloads per parameter-set (geen WAQI-merge).
 * Open in browser: `/api/spire/forecast-debug` of `?lat=&lon=`.
 */
export async function GET(request: Request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try {
    const { lat, lon } = parseOptionalLatLon(request);
    const panel = await fetchSpireForecastDebugPanel(lat, lon, controller.signal);
    clearTimeout(timer);
    return NextResponse.json(
      {
        ...panel,
        hint: 'Ruwe Spire JSON per query. `stats` = aantal rijen + span (uur) tussen eerste/laatste valid_time. `data` max 400 rijen als ingekort.',
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('SPIRE_API_TOKEN')) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Timeout' }, { status: 504 });
    }
    console.error('spire/forecast-debug:', error);
    return NextResponse.json({ error: 'Debug fetch failed' }, { status: 500 });
  }
}
