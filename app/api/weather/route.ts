import { NextResponse } from 'next/server';
import { getSamuiForecastMerged } from '@/lib/spire';

export async function GET() {
  try {
    const finalForecast = await getSamuiForecastMerged();
    if (finalForecast.length === 0) {
      return NextResponse.json(
        { error: 'Geen forecastdata' },
        { status: 502 },
      );
    }
    return NextResponse.json(finalForecast);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout';
    if (message.includes('SPIRE_API_TOKEN')) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    console.error('API Route Error:', error);
    return NextResponse.json({ error: 'Data fetch failed' }, { status: 500 });
  }
}
