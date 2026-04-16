import { NextResponse } from 'next/server';
import { analyzeYesterday } from '@/lib/sammi-analytics';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await analyzeYesterday();

    console.log(
      `[cron/analyze-yesterday] post ${result.postId} graded ${result.score}/10`,
    );

    // Pretty-print the Reality Check to server logs so it's visible in Vercel
    console.log('─'.repeat(60));
    console.log(result.text);
    console.log('─'.repeat(60));

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/analyze-yesterday]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
