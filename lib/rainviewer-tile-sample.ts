/**
 * Sample the RainViewer raster (scheme 2, z7 / 512px) at a lat/lon to see if there is echo
 * at that pixel — same grid as {@link SamuiExploreMap} radar overlay.
 * Runs in the browser (Canvas + fetch); used to prefer radar over dry model rows.
 */

const NATIVE_Z = 7;
const TILE_PX = 512;

function latLonToTileFraction(lat: number, lon: number, z: number): { xTile: number; yTile: number; fx: number; fy: number } {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const xTile = Math.floor(x);
  const yTile = Math.floor(y);
  const fx = (x - xTile) * TILE_PX;
  const fy = (y - yTile) * TILE_PX;
  return { xTile, yTile, fx, fy };
}

/** RainViewer “no echo” is typically near-white; coloured pixels indicate precipitation. */
function pixelLooksLikeEcho(r: number, g: number, b: number, a: number): boolean {
  if (a < 12) return false;
  if (r > 248 && g > 248 && b > 248) return false;
  const sum = r + g + b;
  if (sum > 735 && Math.max(r, g, b) - Math.min(r, g, b) < 18) return false;
  return true;
}

export type RadarEchoSample = 'none' | 'precip' | 'unknown';

/**
 * Fetch the native radar tile for this frame and test a small neighbourhood around the lat/lon.
 */
export async function sampleRadarEchoAtLocation(
  lat: number,
  lon: number,
  framePath: string,
  signal?: AbortSignal,
): Promise<RadarEchoSample> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'unknown';
  }
  const clean = framePath.replace(/^\//, '');
  const { xTile, yTile, fx, fy } = latLonToTileFraction(lat, lon, NATIVE_Z);
  const url = `/api/radar/${clean}/512/${NATIVE_Z}/${xTile}/${yTile}/2/1_1.png`;

  try {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) return 'unknown';
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = TILE_PX;
    canvas.height = TILE_PX;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'unknown';
    ctx.drawImage(bmp, 0, 0);
    const half = 3;
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const ix = Math.round(fx + dx);
        const iy = Math.round(fy + dy);
        if (ix < 0 || iy < 0 || ix >= TILE_PX || iy >= TILE_PX) continue;
        const d = ctx.getImageData(ix, iy, 1, 1).data;
        if (pixelLooksLikeEcho(d[0]!, d[1]!, d[2]!, d[3]!)) return 'precip';
      }
    }
    return 'none';
  } catch {
    if (signal?.aborted) return 'unknown';
    return 'unknown';
  }
}
