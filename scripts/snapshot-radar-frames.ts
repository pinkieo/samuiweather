/**
 * Fetches RainViewer weather-maps.json and writes public/radar-practice.json
 * with `radar.past` frames from roughly the **last 90 minutes** (1.5 h) by frame `time`.
 *
 * Run: npm run radar:snapshot
 * Then set NEXT_PUBLIC_RADAR_PRACTICE=1 in .env.local and restart dev to use this snapshot.
 * `public/radar-practice.json` is gitignored. To update the **committed** sample used when
 * `NEXT_PUBLIC_RADAR_PRACTICE=1` and no local file exists, run: `npm run radar:fixture`
 * (snapshot + copy to `public/radar-practice.fixture.json`).
 */
import * as fs from 'fs';
import * as path from 'path';

const OUT = path.join(process.cwd(), 'public', 'radar-practice.json');

/** Match `/api/radar/frames` window (seconds). */
const WINDOW_SECONDS = 90 * 60;

type PastFrame = { path: string; time: number };

async function main() {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
    headers: { 'User-Agent': 'SamuiWeatherDashboard/1.0 (radar snapshot)' },
  });
  if (!res.ok) {
    console.error('RainViewer API error:', res.status);
    process.exit(1);
  }
  const data = (await res.json()) as {
    radar?: { past?: PastFrame[] };
  };
  const past = Array.isArray(data.radar?.past) ? data.radar!.past! : [];
  const now = Math.floor(Date.now() / 1000);
  const since = now - WINDOW_SECONDS;

  const inWindow = past.filter(f => f.time >= since).sort((a, b) => a.time - b.time);
  /** Fallback: last N scans if API times are sparse or clock skew (~3 h at 10 min cadence) */
  const fallback = past.slice(-18).sort((a, b) => a.time - b.time);
  const frames = inWindow.length > 0 ? inWindow : fallback;

  const payload = {
    savedAt: new Date().toISOString(),
    windowMinutes: 90,
    windowSeconds: WINDOW_SECONDS,
    note:
      'RainViewer past frames in ~1.5 h window. Commit copy: npm run radar:fixture → public/radar-practice.fixture.json',
    source: 'https://api.rainviewer.com/public/weather-maps.json',
    radarPastCount: past.length,
    framesInWindow: inWindow.length,
    frames: frames.map(f => ({ path: f.path, time: f.time })),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(
    `Wrote ${OUT} (${payload.frames.length} frames, ${inWindow.length} in last ${payload.windowMinutes} min window).`,
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
