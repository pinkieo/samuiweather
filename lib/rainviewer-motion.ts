/** Minimal RainViewer frame — avoids importing `radar-hourly-buckets` (cycle). */
export type TimedRadarFrame = { path: string; time: number };

/**
 * Summary of RainViewer nowcast cadence. Used to pick **distinct** frames per future hour
 * when API timestamps are clustered (common) or spread (ideal).
 */
export type RainMovementVector = {
  /** Median Δt (s) between consecutive sorted nowcast frames */
  medianStepSec: number;
  sortedNowcast: TimedRadarFrame[];
  /** All `time` values within ~15 min — prefer index-based routing per hour */
  timesAreClustered: boolean;
};

/**
 * Derive step statistics from `nowcast` frames (RainViewer `radar.nowcast`).
 * No pixel cross-correlation — timing metadata only.
 */
export function calculateRainMovementVector(
  nowcastFrames: TimedRadarFrame[],
): RainMovementVector | null {
  if (!nowcastFrames?.length) return null;
  const sorted = [...nowcastFrames].filter((f) => f?.path && Number.isFinite(f.time));
  sorted.sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return null;

  if (sorted.length === 1) {
    return {
      medianStepSec: 600,
      sortedNowcast: sorted,
      timesAreClustered: true,
    };
  }

  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    deltas.push(sorted[i]!.time - sorted[i - 1]!.time);
  }
  deltas.sort((a, b) => a - b);
  const medianStepSec = deltas[Math.floor(deltas.length / 2)] ?? 600;
  const span = sorted[sorted.length - 1]!.time - sorted[0]!.time;
  const timesAreClustered = span < 900;

  return { medianStepSec, sortedNowcast: sorted, timesAreClustered };
}

/**
 * Map a future-hour offset (1 = next clock hour, …) to a nowcast array index so Play/scrub
 * cycles through different tiles instead of sticking on one path.
 */
export function nowcastIndexForHourOffset(
  motion: RainMovementVector,
  hourOffsetFromCurrent: number,
): number {
  const { sortedNowcast, timesAreClustered } = motion;
  const n = sortedNowcast.length;
  if (n === 0) return 0;
  const off = Math.max(0, Math.round(hourOffsetFromCurrent));
  if (off === 0) return 0;

  if (timesAreClustered) {
    return Math.min(off - 1, n - 1);
  }

  /** Match hybrid strip future span (18 columns → last offset 17). */
  const maxSlot = 17;
  const idx = Math.round(((off - 0.5) / maxSlot) * (n - 1));
  return Math.min(Math.max(idx, 0), n - 1);
}

/**
 * Subtle raster drift (px) so the overlay “nudges” with hour index + wind — purely visual cue
 * (real advection would need image correlation). Wind = meteorological **from** direction (°).
 */
export function rasterDriftPxForHour(
  windDirFromDeg: number,
  hourOffsetFromCurrent: number,
): [number, number] {
  if (hourOffsetFromCurrent <= 0) return [0, 0];
  const rad = (windDirFromDeg * Math.PI) / 180;
  const k = 5;
  const dx = Math.round(Math.sin(rad) * k * hourOffsetFromCurrent);
  const dy = Math.round(-Math.cos(rad) * k * hourOffsetFromCurrent);
  return [dx, dy];
}
