import { NextRequest, NextResponse } from 'next/server';
import { runWeatherIngest } from '@/lib/weather-ingest';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

/**
 * 4× daily Spire ingest → weather_forecast. Not a Vercel Hobby cron.
 * cron-job.org: GET https://www.samuiweather.com/api/cron/weather-ingest?secret=
 */
async function run(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  const auth = req.headers.get('authorization');
  const token = secret || (auth?.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const force =
    req.nextUrl.searchParams.get('force') === '1' ||
    req.nextUrl.searchParams.get('force') === 'true';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25000);
  try {
    const result = await runWeatherIngest({ force, signal: ac.signal });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, ...result.summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ingest failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
