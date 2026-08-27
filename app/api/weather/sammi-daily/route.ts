import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { CACHE_CONTROL_NO_STORE, buildProvenance } from '@/lib/weather-provenance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const DEFAULT_LOC = 'samui_opf_hybrid';

const SELECT_WITH_CEILING =
  'location_id,forecast_date,avg_temp_c,max_temp_c,min_temp_c,kans_regen_pct_sammi,kans_onweer_pct_sammi,kans_mist_pct_sammi,reliability,sammi_advice,conv_cape_max,conv_pwat_max,conv_cin_max,conv_dcape_max,conv_ceiling_min,sammi_tropical_tier,sammi_wind_tier';

const SELECT_WITHOUT_CEILING =
  'location_id,forecast_date,avg_temp_c,max_temp_c,min_temp_c,kans_regen_pct_sammi,kans_onweer_pct_sammi,kans_mist_pct_sammi,reliability,sammi_advice,conv_cape_max,conv_pwat_max,conv_cin_max,conv_dcape_max,sammi_tropical_tier,sammi_wind_tier';

function isMissingCeilingColumn(message: string): boolean {
  return /conv_ceiling_min/i.test(message) && /does not exist/i.test(message);
}

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
  const limit = Math.min(25, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));

  const run = (select: string) =>
    supabase
      .from('sammi_daily_forecast')
      .select(select)
      .eq('location_id', locationId)
      .order('forecast_date', { ascending: true })
      .limit(limit);

  let data: unknown[] | null = null;
  let { data: firstData, error } = await run(SELECT_WITH_CEILING);
  data = firstData;
  let schema: '013' | 'legacy' = '013';
  if (error && isMissingCeilingColumn(error.message)) {
    schema = 'legacy';
    const retry = await run(SELECT_WITHOUT_CEILING);
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
  const firstDate = (rows[0] as { forecast_date?: string } | undefined)?.forecast_date ?? null;
  const freshness = buildProvenance({
    source: 'sammi_forecast',
    staleAfterMinutes: 90,
    issuedAtIso: firstDate ? `${firstDate}T00:00:00+00:00` : null,
    place: 'Koh Samui',
  });

  return NextResponse.json(
    { rows, freshness, view_schema: schema },
    { headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
  );
}
