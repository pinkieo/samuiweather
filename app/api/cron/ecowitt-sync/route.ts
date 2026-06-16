import { NextResponse } from 'next/server';
import { syncEcowittFromCloud } from '@/lib/ecowitt-cloud';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Poll Ecowitt Cloud → Supabase every minute (Vercel cron).
 * Secured with CRON_SECRET. Custom gateway push to /api/ecowitt/ingest still works in parallel.
 */
export async function GET(request: Request) {
  const secret =
    new URL(request.url).searchParams.get('secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';

  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await syncEcowittFromCloud();

  if (!result.ok) {
    console.error('[cron/ecowitt-sync]', result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  if (result.skipped) {
    return NextResponse.json({ ok: true, skipped: true, reason: result.reason });
  }

  console.info('[cron/ecowitt-sync] saved', result.observedAt);
  return NextResponse.json({
    ok: true,
    observedAt: result.observedAt,
    id: result.id,
  });
}
