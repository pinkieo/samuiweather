import { NextResponse } from 'next/server';
import {
  buildBroadcastScriptFromRows,
  parseBroadcastSlot,
} from '@/lib/broadcast-script';
import { getSamuiForecastMerged } from '@/lib/spire';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slot = parseBroadcastSlot(searchParams.get('slot') ?? 'feature_0700');
  if (!slot) {
    return NextResponse.json(
      { error: 'slot must be feature_0700, feature_1100, feature_1500, feature_1900, or hourly' },
      { status: 400 },
    );
  }

  try {
    const rows = await getSamuiForecastMerged();
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No SPIRE data' }, { status: 502 });
    }
    const script = buildBroadcastScriptFromRows(rows, { slot });
    return NextResponse.json(script, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'script failed';
    console.error('[broadcast/script]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
