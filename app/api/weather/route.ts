import { NextResponse } from 'next/server';
import { getSamuiForecastMerged } from '@/lib/spire';

export const revalidate = 3600;

export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const finalForecast = await getSamuiForecastMerged(controller.signal);
    clearTimeout(timer);
    if (finalForecast.length === 0) {
      return NextResponse.json(
        { error: 'Geen forecastdata' },
        { status: 502 },
      );
    }
    return NextResponse.json(finalForecast);
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : 'Onbekende fout';
    if (message.includes('SPIRE_API_TOKEN')) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'Timeout: API reageert niet' }, { status: 504 });
    }
    console.error('API Route Error:', error);
    return NextResponse.json({ error: 'Data fetch failed' }, { status: 500 });
  }
}
