import { NextResponse } from 'next/server';
import { getSamuiForecastMerged } from '@/lib/spire';

export async function GET() {
  try {
    const rows = await getSamuiForecastMerged();
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Geen forecastdata' },
        { status: 502 },
      );
    }
    return NextResponse.json(rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout';
    if (message.includes('SPIRE_API_TOKEN')) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    console.error('spire/forecast:', error);
    return NextResponse.json(
      { error: 'Data fetch failed' },
      { status: 500 },
    );
  }
}
