/**
 * Map overlay URLs for the hybrid strip.
 *
 * Raster tiles routed through RainViewer (`/api/radar/...`) — Spire `/forecast/point`
 * and `/forecast/point/optimized` return JSON, not map tiles. Hour metadata and
 * tooltips come from Spire-backed `SamuiWeatherForecastRow`; live rain imagery stays
 * on the Surat Thani / RainViewer path per the hybrid policy.
 */

import type { RadarFrame } from '@/components/RadarFramesProvider';
import type { HourBucketRadar } from '@/lib/radar-hourly-buckets';
import {
  bangkokWindowHourStarts,
  pickScrubFrameForHour,
} from '@/lib/radar-hourly-buckets';
import { buildRadarPinSnapshotUrl } from '@/lib/rainviewer-snapshot-url';
import {
  dataSourceForClockOffset,
  stripBarIndexToClockOffset,
} from '@/lib/hybrid-strip-data-source';
import { HYBRID_STRIP_PAST_COUNT } from '@/lib/hybrid-rain-timeline';

function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i)!;
  }
  return (h >>> 0).toString(36);
}

/** Short stable cache-buster from the radar feed signature + hour identity. */
export function feedSigCacheKey(
  feedSig: string,
  index: number,
  hourStartUtc: number,
): string {
  return djb2Hash(`${feedSig}|${index}|${hourStartUtc}`);
}

function resolveHourRadarFrame(
  mergedFrames: RadarFrame[],
  nowcastFrames: RadarFrame[],
  hourStartUtc: number,
  anchorHourStartUtc: number,
): RadarFrame | null {
  let frame = pickScrubFrameForHour(
    mergedFrames,
    nowcastFrames,
    hourStartUtc,
    anchorHourStartUtc,
  );
  if (!frame && nowcastFrames.length > 0) {
    const sorted = [...nowcastFrames]
      .filter((f) => f?.path)
      .sort((a, b) => a.time - b.time);
    const hourOff = Math.round((hourStartUtc - anchorHourStartUtc) / 3600);
    const j = Math.min(sorted.length - 1, Math.max(0, hourOff));
    frame = sorted[j] ?? sorted[sorted.length - 1] ?? null;
  }
  if (!frame && mergedFrames.length > 0) {
    const sorted = [...mergedFrames]
      .filter((f) => f?.path)
      .sort((a, b) => a.time - b.time);
    frame = sorted[sorted.length - 1] ?? null;
  }
  return frame;
}

export function getOverlayUrlForIndex(
  index: number,
  ctx: {
    buckets: HourBucketRadar[];
    mergedFrames: RadarFrame[];
    nowcastFrames: RadarFrame[];
    lat: number;
    lon: number;
    feedSig: string;
    /** Bangkok hour starts used for `pickScrubFrameForHour`; pass current window anchor. */
    anchorHourStartUtc: number;
    /**
     * Past-hour count for this strip (map replay = 3: four bars −3h…0).
     * Default matches `HYBRID_STRIP_PAST_COUNT` (drawer 18h strip).
     */
    stripPastCount?: number;
  },
): string | null {
  const { buckets } = ctx;
  const n = buckets.length;
  if (n === 0) return null;
  const i = ((index % n) + n) % n;
  const b = buckets[i];
  if (!b) return null;

  const pastSlots = ctx.stripPastCount ?? HYBRID_STRIP_PAST_COUNT;
  const off = stripBarIndexToClockOffset(i, pastSlots);
  if (dataSourceForClockOffset(off) === 'spire') return null;

  const frame = resolveHourRadarFrame(
    ctx.mergedFrames,
    ctx.nowcastFrames,
    b.hourStartUtc,
    ctx.anchorHourStartUtc,
  );
  if (!frame?.path) return null;

  const base = buildRadarPinSnapshotUrl(frame.path, ctx.lat, ctx.lon);
  const v = feedSigCacheKey(ctx.feedSig, i, b.hourStartUtc);
  return `${base}?v=${encodeURIComponent(v)}`;
}

/**
 * App proxy URL for Spire point JSON (forecast / thunder fields for the pin).
 * Not usable as a map raster; useful for correlating overlay steps with Spire data.
 */
export function buildSpireForecastPointProxyUrl(
  lat: number,
  lon: number,
  feedSig: string,
  hourMidUtcSec: number,
): string {
  const v = feedSigCacheKey(feedSig, 0, hourMidUtcSec);
  const bundles = encodeURIComponent('basic,thunderstorm');
  return `/api/spire/forecast-point?lat=${lat}&lon=${lon}&bundles=${bundles}&v=${encodeURIComponent(v)}`;
}

/** Current window anchor (hour 0 of strip) for frame picking — same as strip internals. */
export function hybridStripAnchorHourStartUtc(nowSec: number): number {
  return bangkokWindowHourStarts(nowSec, 0, 0)[0]!;
}

export { resolveHourRadarFrame };
