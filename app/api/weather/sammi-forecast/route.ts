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
 * Returns hourly `sammi_forecast` (kans_*_sammi, reliability) for UI merge with Spire.
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
  const limit = Math.min(
    500,
    Math.max(1, parseInt(searchParams.get('limit') || '400', 10) || 400),
  );

  const { data, error } = await supabase
    .from('sammi_forecast')
    .select(
      'location_id,valid_time_utc,kans_regen_pct_sammi,kans_onweer_pct_sammi,kans_mist_pct_sammi,reliability,cin,ceiling_m,sammi_tropical_tier,sammi_wind_tier,sammi_convective_line,wind_direction_deg',
    )
    .eq('location_id', locationId)
    .order('valid_time_utc', { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}
