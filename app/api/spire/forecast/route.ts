import { NextResponse } from 'next/server';
import { getForecastMergedAt, SAMUI_CENTER } from '@/lib/spire';

export const dynamic = 'force-dynamic';

/** Edge cache: refresh at most every 6h (replaces frequent cron freshness) */
export const revalidate = 21600;

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

export async function GET(request: Request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const { lat, lon } = parseOptionalLatLon(request);
    const rows = await getForecastMergedAt(lat, lon, controller.signal);
    clearTimeout(timer);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No forecast data from Spire' },
        { status: 502 },
      );
    }
    return NextResponse.json(rows);
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('SPIRE_API_TOKEN')) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Timeout: Spire API did not respond' }, { status: 504 });
    }
    console.error('spire/forecast:', error);
    return NextResponse.json(
      { error: 'Data fetch failed' },
      { status: 500 },
    );
  }
}
