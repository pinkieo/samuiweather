import { NextRequest, NextResponse } from 'next/server';
import {
  ECOWITT_LOCATION_ID,
  fetchEcowittDaily,
  parseIctDateYmd,
  yesterdayIctDate,
} from '@/lib/ecowitt-data';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Station day archive for one ICT calendar day.
 * High/low/rain come from `ecowitt_observations` — not from `/latest` rainDayMm
 * (that counter resets at midnight).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = parseIctDateYmd(url.searchParams.get('date')) ?? yesterdayIctDate();
  const locationId = url.searchParams.get('location')?.trim() || ECOWITT_LOCATION_ID;
  const result = await fetchEcowittDaily(date, locationId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, date, locationId }, { status: 500 });
  }
  return NextResponse.json(result.summary, { headers: { 'Cache-Control': 'no-store' } });
}
