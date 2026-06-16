import { NextResponse } from 'next/server';
import { getRainViewerIngestProof } from '@/lib/rainviewer-ingest-proof';

/**
 * Proxies RainViewer’s public catalog (frame paths + times only; no image bytes in this response).
 * Upstream: https://api.rainviewer.com/public/weather-maps.json — `radar.past` is typically ~2–3 h of scans.
 */
export const runtime = 'edge';
/** Avoid half-stale cached responses in dev — always fresh `weather-maps.json`. */
export const dynamic = 'force-dynamic';

/** If upstream `past` is empty, use the last N scans (RainViewer ~10 min cadence). */
const FALLBACK_TAIL = 18;

export async function GET() {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      headers: { 'User-Agent': 'SamuiWeatherDashboard/1.0' },
      ...(process.env.NODE_ENV === 'development'
        ? ({ cache: 'no-store' } as const)
        : { next: { revalidate: 120 } }),
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          frames: [],
          nowcastFrames: [],
          nowFrame: null,
          upstream: null,
          error: 'upstream_not_ok',
          ingest: getRainViewerIngestProof(),
        },
        { status: 502 },
      );
    }
    const data: unknown = await res.json();
    const past =
      typeof data === 'object' &&
      data !== null &&
      'radar' in data &&
      typeof (data as { radar?: { past?: unknown } }).radar === 'object' &&
      (data as { radar?: { past?: unknown } }).radar !== null
        ? ((data as { radar: { past?: { path: string; time: number }[] } }).radar.past ??
          [])
        : [];
    const list = Array.isArray(past) ? past : [];
    /**
     * RainViewer already delivers `radar.past` as ~2h history (10-min steps). Do not trim again
     * to 90 min — the hourly strip would lose the oldest ICT hour (clickable + color).
     */
    const sortedPast = [...list].sort(
      (a: { time: number }, b: { time: number }) => a.time - b.time,
    );
    const fallback = list
      .slice(-FALLBACK_TAIL)
      .sort((a: { time: number }, b: { time: number }) => a.time - b.time);
    const picked = sortedPast.length > 0 ? sortedPast : fallback;
    const frames = picked.map((f: { path: string; time: number }) => ({
      path: f.path,
      time: f.time,
    }));
    const nowFrame = frames.length > 0 ? frames[frames.length - 1]! : null;

    const nowcastRaw =
      typeof data === 'object' &&
      data !== null &&
      'radar' in data &&
      typeof (data as { radar?: { nowcast?: unknown } }).radar === 'object' &&
      (data as { radar?: { nowcast?: unknown } }).radar !== null
        ? (data as { radar: { nowcast?: { path: string; time: number }[] } }).radar.nowcast
        : [];
    const nowcastList = Array.isArray(nowcastRaw) ? nowcastRaw : [];
    const nowcastFrames = nowcastList
      .filter(
        (f: { path?: string; time?: number }) =>
          typeof f?.path === 'string' && typeof f?.time === 'number',
      )
      .sort((a: { time: number }, b: { time: number }) => a.time - b.time)
      .slice(0, 24)
      .map((f: { path: string; time: number }) => ({ path: f.path, time: f.time }));

    /** Full `weather-maps.json` — station IDs (PHU, SRT, SKA, …) are not inside this JSON; see `ingest`. */
    return NextResponse.json({
      frames,
      nowcastFrames,
      nowFrame,
      upstream: data,
      ingest: getRainViewerIngestProof(),
    });
  } catch {
    return NextResponse.json(
      {
        frames: [],
        nowcastFrames: [],
        nowFrame: null,
        upstream: null,
        error: 'exception',
        ingest: getRainViewerIngestProof(),
      },
      { status: 500 },
    );
  }
}
