import { NextRequest, NextResponse } from 'next/server';
import { fetchDailySamuiTopics } from '@/lib/reddit-fetcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/** Nightly pull of r/kohsamui, r/weathersamui, r/samui → `reddit_samui_posts`. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await fetchDailySamuiTopics();
    if (result.error) {
      return NextResponse.json(
        { ok: false, error: result.error, count: result.count },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      count: result.count,
      subreddits: result.subreddits,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[cron/reddit-fetch]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
