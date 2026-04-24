import { NextResponse } from 'next/server';
import { fetchOpenMeteoTidesAsSpireShape } from '../../../lib/open-meteo-tides';
import {
  SAMUI_CENTER,
  buildTidesPointUrl,
  getSpireApiToken,
} from '../../../lib/spire';
import { isTideResponseUsable } from '../../../lib/tides';

/**
 * Tides — SPIRE `/tides/point` when usable; else Open-Meteo marine `sea_level_height_msl`
 * (same hour grid shape for `lib/tides.ts`). Does not replace official Thai tide tables.
 * GET /api/tides — optioneel ?lat=&lon= (default: Koh Samui center).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat') ?? SAMUI_CENTER.lat);
  const lon = Number(searchParams.get('lon') ?? SAMUI_CENTER.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'Ongeldige lat/lon' }, { status: 400 });
  }

  const token = getSpireApiToken();

  if (token) {
    const url = buildTidesPointUrl(lat, lon, { forecastHours: 120 });
    try {
      const response = await fetch(url, {
        headers: { 'spire-api-key': token },
        cache: 'no-store',
        signal: AbortSignal.timeout(14000),
      });
      const data: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        const fallback = await fetchOpenMeteoTidesAsSpireShape(lat, lon);
        if (fallback && isTideResponseUsable(fallback)) {
          return NextResponse.json(fallback);
        }
        return NextResponse.json(data, { status: response.status });
      }

      if (isTideResponseUsable(data)) {
        return NextResponse.json(data);
      }

      const fallback = await fetchOpenMeteoTidesAsSpireShape(lat, lon);
      if (fallback && isTideResponseUsable(fallback)) {
        return NextResponse.json(fallback);
      }

      return NextResponse.json(data);
    } catch {
      const fallback = await fetchOpenMeteoTidesAsSpireShape(lat, lon);
      if (fallback && isTideResponseUsable(fallback)) {
        return NextResponse.json(fallback);
      }
      return NextResponse.json(
        { error: 'Failed to fetch tides' },
        { status: 500 },
      );
    }
  }

  const fallbackOnly = await fetchOpenMeteoTidesAsSpireShape(lat, lon);
  if (fallbackOnly && isTideResponseUsable(fallbackOnly)) {
    return NextResponse.json(fallbackOnly);
  }

  return NextResponse.json(
    {
      error:
        'SPIRE_API_TOKEN is missing and Open-Meteo marine failed — no tide samples for this location',
    },
    { status: 502 },
  );
}
