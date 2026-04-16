import { NextRequest, NextResponse } from 'next/server';
import { getSamuiForecastMerged } from '@/lib/spire';
import { generateSammiRedditPost, saveDraftPost, IS_DATA_OPTIMIZED } from '@/lib/sammi-post-generator';

export const dynamic    = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await getSamuiForecastMerged();
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No SPIRE data' }, { status: 502 });
    }

    const post = await generateSammiRedditPost(rows);
    const id   = await saveDraftPost(post);

    return NextResponse.json({
      ok:                true,
      draftId:           id,
      title:             post.title,
      radarStatus:       post.radarStatus,
      is_data_optimized: IS_DATA_OPTIMIZED,
      subreddit:         post.subreddit,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/generate-post]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
