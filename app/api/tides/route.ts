import { NextResponse } from 'next/server';
import {
  SAMUI_CENTER,
  buildTidesPointUrl,
  getSpireApiToken,
} from '../../../lib/spire';

/**
 * Tides Point API — ruwe Spire-response voor de getijden-widget.
 * GET /api/tides — optioneel ?lat=&lon= (default: Koh Samui center).
 */
export async function GET(request: Request) {
  const token = getSpireApiToken();
  if (!token) {
    return NextResponse.json(
      { error: 'SPIRE_API_TOKEN ontbreekt' },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat') ?? SAMUI_CENTER.lat);
  const lon = Number(searchParams.get('lon') ?? SAMUI_CENTER.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'Ongeldige lat/lon' }, { status: 400 });
  }

  const url = buildTidesPointUrl(lat, lon);

  try {
    const response = await fetch(url, {
      headers: { 'spire-api-key': token },
    });

    const data: unknown = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch tides' },
      { status: 500 },
    );
  }
}
