import { NextResponse } from 'next/server';
import { getForecastMergedAt, getSpireApiToken, SAMUI_CENTER } from '@/lib/spire';

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
  /** Spire tries many bundle/time_bundle combos (hourly + extended); allow headroom before abort. */
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const { lat, lon } = parseOptionalLatLon(request);
    const hasToken = Boolean(getSpireApiToken());
    // #region agent log
    fetch('http://127.0.0.1:7488/ingest/700ecb43-33c3-46ad-a0f9-880b489bb2e9', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'e62a63',
      },
      body: JSON.stringify({
        sessionId: 'e62a63',
        hypothesisId: 'H5',
        location: 'api/spire/forecast:GET:start',
        message: 'server forecast GET enter',
        data: { hasToken, lat, lon },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const rows = await getForecastMergedAt(lat, lon, controller.signal);
    clearTimeout(timer);
    // #region agent log
    fetch('http://127.0.0.1:7488/ingest/700ecb43-33c3-46ad-a0f9-880b489bb2e9', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'e62a63',
      },
      body: JSON.stringify({
        sessionId: 'e62a63',
        hypothesisId: 'H5',
        location: 'api/spire/forecast:GET:ok',
        message: 'getForecastMergedAt returned',
        data: { rowCount: rows.length },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No forecast data from Spire' },
        { status: 502 },
      );
    }
    return NextResponse.json(rows, {
      headers: {
        /** Browser + CDN may reuse; lat/lon in query already key the response. */
        'Cache-Control':
          'private, max-age=120, s-maxage=120, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : 'Unknown error';
    // #region agent log
    fetch('http://127.0.0.1:7488/ingest/700ecb43-33c3-46ad-a0f9-880b489bb2e9', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'e62a63',
      },
      body: JSON.stringify({
        sessionId: 'e62a63',
        hypothesisId: 'H3',
        location: 'api/spire/forecast:GET:catch',
        message: 'server forecast GET catch',
        data: {
          errName: error instanceof Error ? error.name : 'unknown',
          errMessage: message,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
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
