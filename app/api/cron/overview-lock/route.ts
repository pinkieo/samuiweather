import { NextRequest, NextResponse } from 'next/server';
import { SPIRE_LOCATION_ID } from '@/lib/forecast-day-accuracy';
import { lockDueSlots } from '@/lib/forecast-overview';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

/**
 * Lock the current and previous ICT overview slots to weather_forecast_snapshot.
 * Not a Vercel Hobby cron (sub-daily). Call from LENOVOX13 hourly ingest or cron-job.org.
 */
async function run(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  const auth = req.headers.get('authorization');
  const token = secret || (auth?.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const locationId = req.nextUrl.searchParams.get('location')?.trim() || SPIRE_LOCATION_ID;
  try {
    const locks = await lockDueSlots(locationId);
    return NextResponse.json({ ok: true, locks });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'lock failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
