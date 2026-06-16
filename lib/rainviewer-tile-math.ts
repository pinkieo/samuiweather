/** Shared slippy-map math + RainViewer colour heuristics (z7 / 512px, scheme 2). */

export const RAINVIEWER_NATIVE_Z = 7;
export const RAINVIEWER_TILE_PX = 512;

/** Pixel within a RainViewer tile → WGS84 (same slippy grid as {@link latLonToRainviewerTileFraction}). */
export function tilePixelToLatLon(
  xTile: number,
  yTile: number,
  px: number,
  py: number,
  z: number = RAINVIEWER_NATIVE_Z,
): { lat: number; lon: number } {
  const n = 2 ** z;
  const xf = xTile + px / RAINVIEWER_TILE_PX;
  const yf = yTile + py / RAINVIEWER_TILE_PX;
  const lon = (xf / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * yf) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lon };
}

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

/**
 * Web Mercator ground resolution (m/px) at `lat` for a map tile of `tilePx` pixels, zoom `z`
 * (RainViewer uses 512@z7, same as this project’s `latLonToRainviewerTileFraction`).
 */
export function webMercatorMetersPerPixel(
  lat: number,
  z: number,
  tilePx: number = RAINVIEWER_TILE_PX,
): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  return (cos * 2 * Math.PI * 6378137) / (tilePx * 2 ** z);
}

/**
 * Rough 0–1 “strength” of an echo pixel (higher = stronger / warmer colours in RainViewer’s palette).
 */
export function echoPixelStrength01(r: number, g: number, b: number, a: number): number {
  if (!pixelLooksLikeRainEcho(r, g, b, a)) return 0;
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const sat = (maxC - minC) / 255;
  const dark = 1 - (r + g + b) / (3 * 255);
  const warmBoost = r > 110 && r > g + 8 && r > b + 8 ? 0.18 : 0;
  return Math.min(1, sat * 0.45 + dark * 1.1 + warmBoost);
}
