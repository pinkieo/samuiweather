import { NextResponse } from 'next/server';
import { logWeatherSnapshot } from '@/lib/sammi-analytics';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const snapshot = await logWeatherSnapshot();
    console.log('[cron/log-weather] snapshot saved:', snapshot.valid_time, snapshot.radar_status);
    return NextResponse.json({ ok: true, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/log-weather]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
