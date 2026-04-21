import { NextResponse } from 'next/server';

/** Frisse snapshot voor “nu”-weer in het dashboard (Krabi/Samui). */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Single-location snapshot from meteoblue (same package as /api/meteoblue/forecast).
 * Replaces Windy point — uses METEOBLUE_API_KEY only.
 * GET /api/meteoblue/point?lat=&lon=&asl=
 */
export async function GET(request: Request) {
  const apiKey = process.env.METEOBLUE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'METEOBLUE_API_KEY not configured', enabled: false },
      { status: 200 },
    );
  }

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));
  const aslParam = searchParams.get('asl');
  const asl =
    aslParam != null && aslParam !== ''
      ? Number(aslParam)
      : Number(process.env.METEOBLUE_ASL ?? '5');

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ ok: false, error: 'lat and lon required' }, { status: 400 });
  }

  const aslStr = Number.isFinite(asl) ? String(asl) : '5';
  const url = `https://my.meteoblue.com/packages/basic-1h_clouds-1h_sunmoon?apikey=${apiKey}&lat=${lat}&lon=${lon}&asl=${aslStr}&format=json&tz=Asia%2FBangkok`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    const raw: unknown = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          enabled: true,
          error: 'meteoblue error',
          details: raw,
        },
        { status: 502 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = raw as any;
    const d1h = r.data_1h;
    const dcld = r.data_1h_clouds ?? {};
    const dsun = r.data_day?.sunrise ?? [];

    if (!d1h?.time || !Array.isArray(d1h.time)) {
      return NextResponse.json(
        { ok: false, enabled: true, error: 'unexpected meteoblue shape' },
        { status: 502 },
      );
    }

    const times = d1h.time as string[];
    const now = Date.now();
    let bestI = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = new Date(times[i].replace(' ', 'T')).getTime();
      if (Number.isNaN(t)) continue;
      const diff = Math.abs(t - now);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestI = i;
      }
    }

    const i = bestI;
    const tempC = d1h.temperature?.[i] ?? null;
    const windKmh = d1h.windspeed?.[i] ?? 0;
    const windDir = d1h.winddirection?.[i] ?? 0;
    const precipMm = d1h.precipitation?.[i] ?? 0;

    const windSpeedMs = windKmh / 3.6;

    return NextResponse.json({
      ok: true,
      enabled: true,
      source: 'meteoblue' as const,
      snapshot: {
        tempC: typeof tempC === 'number' ? Math.round(tempC * 10) / 10 : null,
        windSpeedMs: Math.round(windSpeedMs * 100) / 100,
        windDirDeg: Math.round(windDir),
        precipMm: Math.round(precipMm * 100) / 100,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        enabled: true,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
