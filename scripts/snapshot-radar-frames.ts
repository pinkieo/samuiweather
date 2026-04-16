/**
 * Fetches RainViewer weather-maps.json and writes public/radar-practice.json
 * with all `radar.past` frames from roughly the last 60 minutes (by frame `time`).
 *
 * Run: npm run radar:snapshot
 * Then set NEXT_PUBLIC_RADAR_PRACTICE=1 in .env.local and restart dev to loop on the snapshot.
 */
import * as fs from 'fs';
import * as path from 'path';

const OUT = path.join(process.cwd(), 'public', 'radar-practice.json');

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
  const hourAgo = now - 3600;

  const inHour = past.filter(f => f.time >= hourAgo).sort((a, b) => a.time - b.time);
  /** Fallback: last N scans if API times are sparse or clock skew */
  const fallback = past.slice(-18).sort((a, b) => a.time - b.time);
  const frames = inHour.length > 0 ? inHour : fallback;

  const payload = {
    savedAt: new Date().toISOString(),
    source: 'https://api.rainviewer.com/public/weather-maps.json',
    radarPastCount: past.length,
    framesInLastHour: inHour.length,
    frames: frames.map(f => ({ path: f.path, time: f.time })),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(
    `Wrote ${OUT} (${payload.frames.length} frames, ${inHour.length} in last hour window).`,
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
