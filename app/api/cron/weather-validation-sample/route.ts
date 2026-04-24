import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getKrabiForecastMerged, getSamuiForecastMerged, KRABI_FORECAST_POINT, SAMUI_CENTER } from '@/lib/spire';
import { spireRowToValidationJson } from '@/lib/forecast-reference';
import { fetchMeteobluePointSnapshot } from '@/lib/meteoblue-snapshot.server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Stores one hourly snapshot: Spire lead (row 0) + reference grid (same source as the "now" blend) for analytics.
 * GET with ?secret=CRON_SECRET or Authorization: Bearer CRON_SECRET
 * ?location=samui|krabi (default samui)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const secretQ = url.searchParams.get('secret');
  const auth = request.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  const authed =
    (secret && secretQ === secret) || (secret && auth === `Bearer ${secret}`) || !secret;
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { ok: false, error: 'Supabase not configured' },
      { status: 500 },
    );
  }

  const loc = url.searchParams.get('location') === 'krabi' ? 'krabi' : 'samui';
  const point = loc === 'krabi' ? KRABI_FORECAST_POINT : SAMUI_CENTER;
  const locationId = loc === 'krabi' ? 'krabi_baan_mook_taley' : 'samui_opf_hybrid';

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25_000);

  try {
    const rows =
      loc === 'krabi'
        ? await getKrabiForecastMerged(ac.signal)
        : await getSamuiForecastMerged(ac.signal);
    const row0 = rows[0];
    if (!row0) {
      return NextResponse.json({ ok: false, error: 'no forecast row' }, { status: 502 });
    }

    const forecastValid = new Date(row0.time);
    if (Number.isNaN(forecastValid.getTime())) {
      return NextResponse.json({ ok: false, error: 'invalid row time' }, { status: 500 });
    }

    const mb = await fetchMeteobluePointSnapshot(point.lat, point.lon, undefined, ac.signal);
    const referenceGrid = mb.ok && mb.enabled ? mb.snapshot : null;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('weather_validation')
      .insert({
        location_id: locationId,
        forecast_valid_utc: forecastValid.toISOString(),
        spire_snapshot: spireRowToValidationJson(row0) as unknown as Record<string, unknown>,
        reference_grid_snapshot: referenceGrid,
        observation: null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[weather-validation-sample]', error.message);
      return NextResponse.json(
        { ok: false, error: error.message, note: 'Run supabase/017_weather_validation.sql if missing' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      id: data.id,
      location: loc,
      reference_grid: referenceGrid != null,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error('[weather-validation-sample]', m);
    return NextResponse.json({ ok: false, error: m }, { status: 500 });
  } finally {
    clearTimeout(t);
  }
}
