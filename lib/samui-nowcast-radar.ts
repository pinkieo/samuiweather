/**
 * RainViewer catalog + reflectivity for the Samui nowcast.
 *
 * Public tiles in this repo use color scheme 2 (Universal Blue). The dBZ
 * table is RainViewer's published rain column, unsmoothed (`0_0` tiles).
 * A pixel that is not an exact palette color is not assigned a dBZ.
 *
 * Source: https://www.rainviewer.com/files/rainviewer_api_colors_table.csv
 * Scheme id 2 = Universal Blue (https://www.rainviewer.com/api/color-schemes.html).
 */

import {
  latLonToRainviewerTileFraction,
  RAINVIEWER_NATIVE_Z,
  RAINVIEWER_TILE_PX,
  tilePixelToLatLon,
  webMercatorMetersPerPixel,
} from './rainviewer-tile-math';
import type { RadarCell } from './samui-nowcast';

/** Universal Blue rain colors, dBZ 15–75, alpha ≥ 200, first match wins. */
const UNIVERSAL_BLUE_DBZ =
  '15,136,221,238,16,108,209,235,17,81,197,232,18,54,186,229,19,27,174,226,20,0,163,224,21,0,154,213,22,0,145,202,23,0,136,191,24,0,127,180,25,0,119,170,26,0,112,163,27,0,105,156,28,0,98,149,29,0,91,142,30,0,85,136,31,0,81,128,32,0,78,120,33,0,74,112,34,0,71,104,35,255,238,0,36,255,224,0,37,255,210,0,38,255,197,0,39,255,183,0,40,255,170,0,41,255,159,0,42,255,149,0,43,255,139,0,44,255,129,0,45,255,68,0,46,242,54,0,47,230,40,0,48,217,27,0,49,205,13,0,50,193,0,0,51,168,0,0,52,143,0,0,53,118,0,0,54,93,0,0,55,255,170,255,56,255,159,255,57,255,149,255,58,255,139,255,59,255,129,255,60,255,119,255,61,255,108,255,62,255,98,255,63,255,88,255,64,255,78,255,65,255,255,255,75,0,255,0';

const DBZ_BY_RGB = new Map<number, number>();
{
  const nums = UNIVERSAL_BLUE_DBZ.split(',').map((n) => Number(n));
  for (let i = 0; i + 3 < nums.length; i += 4) {
    const dbz = nums[i]!;
    const r = nums[i + 1]!;
    const g = nums[i + 2]!;
    const b = nums[i + 3]!;
    const key = (r << 16) | (g << 8) | b;
    if (!DBZ_BY_RGB.has(key)) DBZ_BY_RGB.set(key, dbz);
  }
}

export type RainViewerFrameRef = {
  path: string;
  time: number;
  kind: 'past' | 'nowcast';
};

export type RainViewerCatalog = {
  host: string | null;
  generatedUnix: number | null;
  past: RainViewerFrameRef[];
  nowcast: RainViewerFrameRef[];
};

function frameList(raw: unknown, kind: 'past' | 'nowcast'): RainViewerFrameRef[] {
  if (!Array.isArray(raw)) return [];
  const out: RainViewerFrameRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const path = (item as { path?: unknown }).path;
    const time = (item as { time?: unknown }).time;
    if (typeof path !== 'string' || !path) continue;
    if (typeof time !== 'number' || !Number.isFinite(time)) continue;
    out.push({ path, time, kind });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** `weather-maps.json`. Nowcast-product frames are kept apart from genuine past scans. */
export function parseRainViewerMaps(json: unknown): RainViewerCatalog {
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const host = typeof root.host === 'string' ? root.host.replace(/\/$/, '') : null;
  const generatedUnix = typeof root.generated === 'number' ? root.generated : null;
  const radar =
    root.radar && typeof root.radar === 'object' ? (root.radar as Record<string, unknown>) : {};
  return {
    host,
    generatedUnix,
    past: frameList(radar.past, 'past'),
    nowcast: frameList(radar.nowcast, 'nowcast'),
  };
}

/**
 * Exact Universal Blue match. Returns null when the pixel is not in the
 * published table (smoothed blends, empty, or an unknown color).
 */
export function dbzFromUniversalBlue(r: number, g: number, b: number, a: number): number | null {
  if (a < 200) return null;
  const key = ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
  return DBZ_BY_RGB.get(key) ?? null;
}

export function coverageRadiusKm(
  lat: number,
  lon: number,
  z: number = RAINVIEWER_NATIVE_Z,
  tilePx: number = RAINVIEWER_TILE_PX,
): number {
  const { fx, fy } = latLonToRainviewerTileFraction(lat, lon, z);
  const edgePx = Math.min(fx, fy, tilePx - fx, tilePx - fy);
  const meters = edgePx * webMercatorMetersPerPixel(lat, z, tilePx);
  return meters / 1000;
}

export type TileReflectivityScan = {
  cells: RadarCell[];
  opaquePixels: number;
  matchedPixels: number;
};

/**
 * Connected >=20 dBZ blobs on one decoded tile.
 * Sub-20 palette colors count as matched reflectivity but not as cells.
 */
export function scanTileReflectivity(args: {
  rgba: Uint8Array;
  width: number;
  height: number;
  xTile: number;
  yTile: number;
  z?: number;
  minDbz?: number;
}): TileReflectivityScan {
  const z = args.z ?? RAINVIEWER_NATIVE_Z;
  const minDbz = args.minDbz ?? 20;
  const { rgba, width, height, xTile, yTile } = args;
  const mask = new Uint8Array(width * height);
  const dbzGrid = new Int16Array(width * height);
  let opaque = 0;
  let matched = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const a = rgba[o + 3] ?? 0;
    if (a > 20) opaque++;
    const dbz = dbzFromUniversalBlue(rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0, a);
    if (dbz == null) continue;
    matched++;
    dbzGrid[i] = dbz;
    if (dbz >= minDbz) mask[i] = 1;
  }

  const seen = new Uint8Array(mask.length);
  const cells: RadarCell[] = [];
  const mpp = webMercatorMetersPerPixel(
    tilePixelToLatLon(xTile, yTile, width / 2, height / 2, z).lat,
    z,
    width,
  );
  const pixelKm2 = (mpp / 1000) ** 2;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let count = 0;
    let maxDbz = 0;
    let sumLat = 0;
    let sumLon = 0;
    for (let s = 0; s < stack.length; s++) {
      const idx = stack[s]!;
      const x = idx % width;
      const y = Math.floor(idx / width);
      count++;
      const dbz = dbzGrid[idx] ?? 0;
      if (dbz > maxDbz) maxDbz = dbz;
      const ll = tilePixelToLatLon(xTile, yTile, x + 0.5, y + 0.5, z);
      sumLat += ll.lat;
      sumLon += ll.lon;
      const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
      for (const n of neighbors) {
        if (n < 0 || n >= mask.length || seen[n] || !mask[n]) continue;
        if (n === idx - 1 && x === 0) continue;
        if (n === idx + 1 && x === width - 1) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    cells.push({
      lat: sumLat / count,
      lon: sumLon / count,
      dbz: maxDbz,
      areaKm2: count * pixelKm2,
    });
  }

  return { cells, opaquePixels: opaque, matchedPixels: matched };
}
