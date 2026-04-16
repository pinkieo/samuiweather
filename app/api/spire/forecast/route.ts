import { NextResponse } from 'next/server';
import { getSamuiForecastMerged } from '@/lib/spire';

/** Edge cache: refresh at most every 6h (replaces frequent cron freshness) */
export const revalidate = 21600;

export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const rows = await getSamuiForecastMerged(controller.signal);
    clearTimeout(timer);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Geen forecastdata' },
        { status: 502 },
      );
    }
    return NextResponse.json(rows);
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : 'Onbekende fout';
    if (message.includes('SPIRE_API_TOKEN')) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Timeout: Spire API reageert niet' }, { status: 504 });
    }
    console.error('spire/forecast:', error);
    return NextResponse.json(
      { error: 'Data fetch failed' },
      { status: 500 },
    );
  }
}
