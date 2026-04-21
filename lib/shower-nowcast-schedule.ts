import type { RadarEchoSample } from './rainviewer-tile-sample';
import { sampleRadarEchoAtLocation } from './rainviewer-tile-sample';

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

/** Meteorological wind direction (degrees): direction wind comes *from*. */
export function compass16FromDeg(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(d / 22.5) % 16]!;
}

export type ShowerNowcastRow = {
  timeUnix: number;
  echo: RadarEchoSample;
};

/**
 * Sample RainViewer nowcast frames at the pin (same z7 tile grid as the live overlay).
 * Batches requests to avoid stalling the main thread.
 */
export async function buildShowerNowcastSchedule(
  lat: number,
  lon: number,
  nowcastFrames: { path: string; time: number }[],
  signal?: AbortSignal,
): Promise<ShowerNowcastRow[]> {
  const out: ShowerNowcastRow[] = [];
  const batch = 3;
  for (let i = 0; i < nowcastFrames.length; i += batch) {
    if (signal?.aborted) break;
    const slice = nowcastFrames.slice(i, i + batch);
    const chunk = await Promise.all(
      slice.map(async (f) => ({
        timeUnix: f.time,
        echo: await sampleRadarEchoAtLocation(lat, lon, f.path, signal),
      })),
    );
    out.push(...chunk);
  }
  return out;
}

export async function comparePastEchoAtPin(
  lat: number,
  lon: number,
  pastFrames: { path: string; time: number }[],
  signal?: AbortSignal,
): Promise<'arriving' | 'leaving' | 'steady' | 'unknown'> {
  if (pastFrames.length < 2) return 'unknown';
  const a = pastFrames[pastFrames.length - 2]!;
  const b = pastFrames[pastFrames.length - 1]!;
  const [ea, eb] = await Promise.all([
    sampleRadarEchoAtLocation(lat, lon, a.path, signal),
    sampleRadarEchoAtLocation(lat, lon, b.path, signal),
  ]);
  if (ea === 'unknown' || eb === 'unknown') return 'unknown';
  if (ea === 'none' && eb === 'precip') return 'arriving';
  if (ea === 'precip' && eb === 'none') return 'leaving';
  return 'steady';
}
