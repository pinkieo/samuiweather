import { NextResponse } from 'next/server';

export const runtime = 'edge';

/** Last N RainViewer `past` frames for the animated radar player (proxied tiles stay on /api/radar/...). */
const FRAME_COUNT = 5;

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
    const last = list.slice(-FRAME_COUNT);
    return NextResponse.json({
      frames: last.map((f: { path: string; time: number }) => ({
        path: f.path,
        time: f.time,
      })),
    });
  } catch {
    return NextResponse.json({ frames: [] }, { status: 500 });
  }
}
