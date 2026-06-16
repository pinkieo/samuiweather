import type { RadarFrame } from '@/components/RadarFramesProvider';
import type { HourBucketRadar } from '@/lib/radar-hourly-buckets';
import type { HybridHour } from '@/lib/hybrid-rain-timeline';
import type { SamuiWeatherForecastRow } from '@/lib/spire';

/** Spire-driven fields for one strip column (from merged hourly row). */
export interface SpireForecastFrame {
  validTimeIso: string;
  pop: number;
  pwat: number | null;
  cape: number | null;
}

/** RainViewer frame at the pin for live / nowcast scrub. */
export interface SpireNowcastFrame {
  path: string;
  time: number;
}

/** One hybrid hour column: radar bucket + blend row + nearest Spire hour. */
export interface HybridRainBar {
  index: number;
  bucket: HourBucketRadar;
  hybrid: HybridHour | null;
  forecast: SpireForecastFrame | null;
  radarFrame: RadarFrame | null;
}

export interface HybridRainData {
  bars: HybridRainBar[];
  feedSig: string;
}

export function toSpireForecastFrame(
  row: SamuiWeatherForecastRow | null,
): SpireForecastFrame | null {
  if (!row) return null;
  return {
    validTimeIso: row.time,
    pop: row.pop,
    pwat: row.pwat ?? null,
    cape: row.cape ?? null,
  };
}
