import { NextResponse } from 'next/server';

export const runtime = 'edge';

/** If nothing falls in the last-hour window, use the last N scans (RainViewer ~10 min cadence). */
const FALLBACK_TAIL = 18;

export async function GET() {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      headers: { 'User-Agent': 'SamuiWeatherDashboard/1.0' },
      next: { revalidate: 120 },
    });
    if (!res.ok) {
      return NextResponse.json({ frames: [] }, { status: 502 });
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
    const now = Math.floor(Date.now() / 1000);
    const hourAgo = now - 3600;
    const inHour = list
      .filter((f: { time: number }) => f.time >= hourAgo)
      .sort((a: { time: number }, b: { time: number }) => a.time - b.time);
    const fallback = list
      .slice(-FALLBACK_TAIL)
      .sort((a: { time: number }, b: { time: number }) => a.time - b.time);
    const picked = inHour.length > 0 ? inHour : fallback;
    return NextResponse.json({
      frames: picked.map((f: { path: string; time: number }) => ({
        path: f.path,
        time: f.time,
      })),
    });
  } catch {
    return NextResponse.json({ frames: [] }, { status: 500 });
  }
}
