import { NextRequest, NextResponse } from 'next/server';
import { generateDailySammiTopic } from '@/lib/daily-sammi-topic';
import { getSamuiForecastMerged } from '@/lib/spire';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * Pick best unused topic, write Sammi Q&A + persist `summary` / `best_answer` on that row.
 * Run after `reddit-fetch` has populated the table.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await getSamuiForecastMerged().catch(() => null);
    const result = await generateDailySammiTopic({
      forecastRows: rows ?? undefined,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? 'Unknown failure' },
        { status: result.error?.includes('No unused') ? 404 : 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      chosenRedditId: result.chosenRedditId,
      question: result.question,
      answer: result.answer,
      summary: result.summary,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[cron/daily-sammi-topic]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
