/**
 * Sample the RainViewer raster (scheme 2, z7 / 512px) at a lat/lon to see if there is echo
 * at that pixel — same grid as {@link SamuiExploreMap} radar overlay.
 * Runs in the browser (Canvas + fetch); used to prefer radar over dry model rows.
 */

import {
  latLonToRainviewerTileFraction,
  pixelLooksLikeRainEcho,
  RAINVIEWER_NATIVE_Z,
  RAINVIEWER_TILE_PX,
} from './rainviewer-tile-math';
import {
  RADAR_PROFILE_OFFSETS_KRABI,
  RADAR_PROFILE_OFFSETS_SAMUI,
  RADAR_PROFILE_OFFSETS_TIMELINE_KRABI,
  RADAR_PROFILE_OFFSETS_TIMELINE_SAMUI,
} from './radar-profile-offsets';

export type RadarEchoSample = 'none' | 'precip' | 'unknown';

function scanCanvasDisc(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  half: number,
): boolean {
  const r2 = half * half;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const ix = Math.round(fx + dx);
      const iy = Math.round(fy + dy);
      if (ix < 0 || iy < 0 || ix >= RAINVIEWER_TILE_PX || iy >= RAINVIEWER_TILE_PX) continue;
      const d = ctx.getImageData(ix, iy, 1, 1).data;
      if (pixelLooksLikeRainEcho(d[0]!, d[1]!, d[2]!, d[3]!)) return true;
    }
  }
  return false;
}

export type SampleRadarEchoOptions = {
  /** Circular neighbourhood radius in pixels (native 512 tile). Default 3. */
  halfPx?: number;
};

/**
 * Fetch the native radar tile for this frame and test a neighbourhood around the lat/lon.
 */
export async function sampleRadarEchoAtLocation(
  lat: number,
  lon: number,
  framePath: string,
  signal?: AbortSignal,
  options?: SampleRadarEchoOptions,
): Promise<RadarEchoSample> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'unknown';
  }
  const half = options?.halfPx ?? 3;
  const clean = framePath.replace(/^\//, '');
  const { xTile, yTile, fx, fy } = latLonToRainviewerTileFraction(lat, lon, RAINVIEWER_NATIVE_Z);
  const url = `/api/radar/${clean}/512/${RAINVIEWER_NATIVE_Z}/${xTile}/${yTile}/2/1_1.png`;

  let bmp: ImageBitmap | undefined;
  try {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) return 'unknown';
    const blob = await res.blob();
    bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = RAINVIEWER_TILE_PX;
    canvas.height = RAINVIEWER_TILE_PX;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'unknown';
    ctx.drawImage(bmp, 0, 0);
    if (scanCanvasDisc(ctx, fx, fy, half)) return 'precip';
    return 'none';
  } catch {
    if (signal?.aborted) return 'unknown';
    return 'unknown';
  } finally {
    bmp?.close();
  }
}

/**
 * Pin + ring of offsets (Buienradar-style: cell may pass north/east of villa).
 */
export type SampleRadarNearPinMode = 'full' | 'timeline';

export async function sampleRadarEchoNearPin(
  lat: number,
  lon: number,
  framePath: string,
  signal: AbortSignal | undefined,
  product: 'krabi' | 'samui',
  mode: SampleRadarNearPinMode = 'full',
): Promise<RadarEchoSample> {
  const timeline = mode === 'timeline';
  const offsets =
    product === 'krabi'
      ? timeline
        ? RADAR_PROFILE_OFFSETS_TIMELINE_KRABI
        : RADAR_PROFILE_OFFSETS_KRABI
      : timeline
        ? RADAR_PROFILE_OFFSETS_TIMELINE_SAMUI
        : RADAR_PROFILE_OFFSETS_SAMUI;
  const halfPx = timeline ? (product === 'krabi' ? 44 : 30) : product === 'krabi' ? 52 : 36;
  let anyUnknown = false;
  for (const [dLat, dLon] of offsets) {
    const r = await sampleRadarEchoAtLocation(lat + dLat, lon + dLon, framePath, signal, { halfPx });
    if (r === 'precip') return 'precip';
    if (r === 'unknown') anyUnknown = true;
  }
  return anyUnknown ? 'unknown' : 'none';
}
