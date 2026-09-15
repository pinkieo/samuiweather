import { NextRequest, NextResponse } from 'next/server';
import { parseIctDateYmd } from '@/lib/ecowitt-data';
import { SPIRE_LOCATION_ID } from '@/lib/forecast-day-accuracy';
import {
  buildForecastOverview,
  currentOverviewSlot,
  lockDueSlots,
  lockSlot,
  parseOverviewSlot,
} from '@/lib/forecast-overview';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

/** 4× daily Spire+OPF overview locked to ICT slots, with Ecowitt raw comparison. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = parseIctDateYmd(url.searchParams.get('date')) ?? undefined;
  const locationId = url.searchParams.get('location')?.trim() || SPIRE_LOCATION_ID;
  try {
    const overview = await buildForecastOverview({ date, locationId });
    return NextResponse.json(overview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'overview failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Lock one slot (`?date=&slot=`) or the current + previous due slots. */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const locationId = url.searchParams.get('location')?.trim() || SPIRE_LOCATION_ID;
  const date = parseIctDateYmd(url.searchParams.get('date'));
  const slot = parseOverviewSlot(url.searchParams.get('slot'));
  try {
    if (date && slot) {
      const lock = await lockSlot(date, slot, locationId);
      return NextResponse.json({ ok: true, locks: [lock] });
    }
    const due = date
      ? [await lockSlot(date, slot ?? currentOverviewSlot().slot, locationId)]
      : await lockDueSlots(locationId);
    return NextResponse.json({ ok: true, locks: due });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'lock failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
