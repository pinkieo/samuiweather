import { NextResponse } from 'next/server';
import { getForecastMergedAt, getSpireApiToken, SAMUI_CENTER } from '@/lib/spire';
import {
  CACHE_CONTROL_NO_STORE,
  SAMUI_PLACE,
  buildProvenance,
  isInVacationBbox,
  provenanceHeaders,
} from '@/lib/weather-provenance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

/**
 * Default without lat/lon: Koh Samui (9.5127, 100.0137).
 * Explicit coordinates are accepted only inside the south-Thailand vacation box
 * (Samui / Krabi / Phuket). Never a silent global or geo-IP fallback.
 */
function parseLatLon(request: Request):
  | { ok: true; lat: number; lon: number; defaulted: boolean }
  | { ok: false; status: number; error: string } {
  const { searchParams } = new URL(request.url);
  const latRaw = searchParams.get('lat');
  const lonRaw = searchParams.get('lon');
  if ((latRaw == null || latRaw === '') && (lonRaw == null || lonRaw === '')) {
    return { ok: true, lat: SAMUI_CENTER.lat, lon: SAMUI_CENTER.lon, defaulted: true };
  }
  if (latRaw == null || lonRaw == null || latRaw === '' || lonRaw === '') {
    return { ok: false, status: 400, error: 'Both lat and lon are required, or omit both for Koh Samui.' };
  }
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, status: 400, error: 'lat and lon must be numbers.' };
  }
  if (!isInVacationBbox(lat, lon)) {
    return {
      ok: false,
      status: 400,
      error:
        'lat/lon is outside the Koh Samui vacation area (south Thailand). Omit both to use Koh Samui.',
    };
  }
  return { ok: true, lat, lon, defaulted: false };
}

export async function GET(request: Request) {
  const parsed = parseLatLon(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, default_place: SAMUI_PLACE },
      { status: parsed.status, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  }

  const { lat, lon, defaulted } = parsed;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    if (!getSpireApiToken()) {
      return NextResponse.json(
        { error: 'SPIRE_API_TOKEN is missing' },
        { status: 500, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
      );
    }
    const rows = await getForecastMergedAt(lat, lon, controller.signal);
    clearTimeout(timer);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No forecast data from Spire' },
        { status: 502, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
      );
    }
    const fetchedAt = Math.floor(Date.now() / 1000);
    const firstTime = rows[0]?.time ?? null;
    const provenance = buildProvenance({
      source: 'spire',
      staleAfterMinutes: 90,
      issuedAtIso: firstTime,
      nowUnix: fetchedAt,
      place: defaulted ? SAMUI_PLACE.name : undefined,
      lat,
      lon,
    });
    return NextResponse.json(rows, {
      headers: {
        ...provenanceHeaders(provenance),
        ...(defaulted ? { 'X-Weather-Default': 'koh-samui' } : {}),
      },
    });
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('SPIRE_API_TOKEN')) {
      return NextResponse.json(
        { error: message },
        { status: 500, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Timeout: Spire API did not respond' },
        { status: 504, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
      );
    }
    console.error('spire/forecast:', error);
    return NextResponse.json(
      { error: 'Data fetch failed' },
      { status: 500, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  }
}
