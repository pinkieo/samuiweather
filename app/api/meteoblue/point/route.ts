import { NextResponse } from 'next/server';
import { fetchMeteobluePointSnapshot } from '@/lib/meteoblue-snapshot.server';

/** Fresh snapshot for “now” weather in the dashboard (Krabi/Samui). */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Single-location snapshot (shared fetch in {@link fetchMeteobluePointSnapshot}).
 * GET /api/meteoblue/point?lat=&lon=&asl=
 */
export async function GET(request: Request) {
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

  const result = await fetchMeteobluePointSnapshot(
    lat,
    lon,
    Number.isFinite(asl) ? asl : 5,
  );

  if (!result.enabled) {
    return NextResponse.json(
      { ok: false, error: result.error, enabled: false },
      { status: 200 },
    );
  }

  if (!result.ok) {
    const shapeIssue = result.error.includes('unexpected meteoblue');
    const upstream = result.upstreamStatus != null;
    const status = shapeIssue || upstream ? 502 : 500;
    const debug =
      process.env.NODE_ENV === 'development' && result.upstreamBodySnippet
        ? { debug: result.upstreamBodySnippet }
        : {};
    return NextResponse.json(
      {
        ok: false,
        enabled: true,
        error: result.error,
        upstreamStatus: result.upstreamStatus,
        ...debug,
      },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    enabled: true,
    source: 'meteoblue' as const,
    snapshot: result.snapshot,
  });
}
