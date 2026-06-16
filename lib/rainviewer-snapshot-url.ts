/**
 * Single-tile “screenshot” URL for the RainViewer frame under a pin (z7 / 512px, scheme 2).
 * Same grid as {@link sampleRadarEchoAtLocation} — Buienradar-style overlay on the map.
 */

import { latLonToRainviewerTileFraction, RAINVIEWER_NATIVE_Z } from './rainviewer-tile-math';

export function buildRadarPinSnapshotUrl(
  framePath: string,
  lat: number,
  lon: number,
): string {
  const clean = framePath.replace(/^\//, '');
  const { xTile, yTile } = latLonToRainviewerTileFraction(lat, lon, RAINVIEWER_NATIVE_Z);
  return `/api/radar/${clean}/512/${RAINVIEWER_NATIVE_Z}/${xTile}/${yTile}/2/1_1.png`;
}
