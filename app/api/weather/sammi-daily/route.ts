import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const DEFAULT_LOC = 'samui_opf_hybrid';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key);
}

/**
 * GET ?location_id=…&limit=…
 * Returns `sammi_daily_forecast` (Bangkok day: kans_*, reliability, sammi_advice).
 */
export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Server misconfigured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' },
      { status: 500 },
    );
  }
  const { searchParams } = new URL(req.url);
  const locationId =
    searchParams.get('location_id')?.trim() ||
    process.env.WEATHER_LOCATION_ID?.trim() ||
    DEFAULT_LOC;
  const limit = Math.min(25, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));

  const { data, error } = await supabase
    .from('sammi_daily_forecast')
    .select(
      'location_id,forecast_date,avg_temp_c,max_temp_c,min_temp_c,kans_regen_pct_sammi,kans_onweer_pct_sammi,kans_mist_pct_sammi,reliability,sammi_advice',
    )
    .eq('location_id', locationId)
    .order('forecast_date', { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}
