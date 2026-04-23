/** Shared slippy-map math + RainViewer colour heuristics (z7 / 512px, scheme 2). */

export const RAINVIEWER_NATIVE_Z = 7;
export const RAINVIEWER_TILE_PX = 512;

export function latLonToRainviewerTileFraction(
  lat: number,
  lon: number,
  z: number,
): { xTile: number; yTile: number; fx: number; fy: number } {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const xTile = Math.floor(x);
  const yTile = Math.floor(y);
  const fx = (x - xTile) * RAINVIEWER_TILE_PX;
  const fy = (y - yTile) * RAINVIEWER_TILE_PX;
  return { xTile, yTile, fx, fy };
}

/** RainViewer “no echo” is typically near-white; coloured pixels indicate precipitation. */
export function pixelLooksLikeRainEcho(r: number, g: number, b: number, a: number): boolean {
  if (a < 12) return false;
  if (r > 248 && g > 248 && b > 248) return false;
  const sum = r + g + b;
  if (sum > 735 && Math.max(r, g, b) - Math.min(r, g, b) < 18) return false;
  return true;
}
