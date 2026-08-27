import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  CACHE_CONTROL_NO_STORE,
  SAMUI_PLACE,
  buildProvenance,
} from '@/lib/weather-provenance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/**
 * GitHub-hosted ingest health for the vacation app.
 * Does not trigger ingest.
 */
export async function GET() {
  const sb = getSupabaseAdmin();
  const fetchedAt = Math.floor(Date.now() / 1000);
  if (!sb) {
    return NextResponse.json(
      { error: 'Server misconfigured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' },
      { status: 500, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  }
  const locationId = process.env.WEATHER_LOCATION_ID?.trim() || 'samui_opf_hybrid';
  const { data, error } = await sb
    .from('weather_forecast')
    .select('valid_time_utc,issuance_time_utc,updated_at')
    .eq('location_id', locationId)
    .order('updated_at', { ascending: false })
    .limit(400);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  }
  const rows = data ?? [];
  const updatedAt = rows[0]?.updated_at ? String(rows[0].updated_at) : null;
  const issuance = rows[0]?.issuance_time_utc ? String(rows[0].issuance_time_utc) : null;
  const valids = rows.map(r => String(r.valid_time_utc)).sort();
  const freshness = buildProvenance({
    source: 'supabase_forecast',
    staleAfterMinutes: 90,
    issuedAtIso: issuance,
    observedAtIso: updatedAt,
    nowUnix: fetchedAt,
    place: SAMUI_PLACE.name,
    lat: SAMUI_PLACE.lat,
    lon: SAMUI_PLACE.lon,
  });

  const nowIso = new Date(fetchedAt * 1000).toISOString();
  const coversNow = valids.some(v => v >= nowIso);

  return NextResponse.json(
    {
      location: { ...SAMUI_PLACE, location_id: locationId },
      freshness,
      ingest: {
        updated_at: updatedAt,
        issued_at: issuance,
        first_valid_time_utc: valids[0] ?? null,
        last_valid_time_utc: valids[valids.length - 1] ?? null,
        row_count: rows.length,
        covers_current_hour: coversNow,
      },
    },
    {
      headers: {
        'Cache-Control': CACHE_CONTROL_NO_STORE,
        'X-Weather-Stale': freshness.stale ? '1' : '0',
        'X-Fetched-At': freshness.fetched_at,
      },
    },
  );
}
