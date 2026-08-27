import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { CACHE_CONTROL_NO_STORE, buildProvenance } from '@/lib/weather-provenance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const DEFAULT_LOC = 'samui_opf_hybrid';

/**
 * GET ?location_id=…&limit=…
 * Returns hourly `sammi_forecast` (kans_*_sammi, reliability) for UI merge with Spire.
 */
export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Server misconfigured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' },
      { status: 500, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  }
  const { searchParams } = new URL(req.url);
  const locationId =
    searchParams.get('location_id')?.trim() ||
    process.env.WEATHER_LOCATION_ID?.trim() ||
    DEFAULT_LOC;
  const limit = Math.min(
    500,
    Math.max(1, parseInt(searchParams.get('limit') || '400', 10) || 400),
  );

  const selectFull =
    'location_id,valid_time_utc,issuance_time_utc,last_updated,kans_regen_pct_sammi,kans_onweer_pct_sammi,kans_mist_pct_sammi,reliability,cin,ceiling_m,sammi_tropical_tier,sammi_wind_tier,sammi_convective_line,wind_direction_deg';
  const selectCore =
    'location_id,valid_time_utc,kans_regen_pct_sammi,kans_onweer_pct_sammi,kans_mist_pct_sammi,reliability,cin,ceiling_m,sammi_tropical_tier,sammi_wind_tier,sammi_convective_line,wind_direction_deg';

  let data: unknown[] | null = null;
  let { data: firstData, error } = await supabase
    .from('sammi_forecast')
    .select(selectFull)
    .eq('location_id', locationId)
    .order('valid_time_utc', { ascending: true })
    .limit(limit);
  data = firstData;

  if (error && /does not exist/i.test(error.message)) {
    const retry = await supabase
      .from('sammi_forecast')
      .select(selectCore)
      .eq('location_id', locationId)
      .order('valid_time_utc', { ascending: true })
      .limit(limit);
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  }
  const rows = data ?? [];
  const first = rows[0] as
    | { valid_time_utc?: string; issuance_time_utc?: string; last_updated?: string }
    | undefined;
  const freshness = buildProvenance({
    source: 'sammi_forecast',
    staleAfterMinutes: 90,
    issuedAtIso: first?.issuance_time_utc ?? first?.last_updated ?? null,
    observedAtIso: first?.last_updated ?? null,
    place: 'Koh Samui',
  });
  return NextResponse.json(
    { rows, freshness },
    { headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
  );
}
