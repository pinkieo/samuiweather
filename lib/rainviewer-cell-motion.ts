/**
 * Dominant rain-cell tracking on RainViewer z7 / 512px tiles: compare consecutive nowcast
 * frames, largest echo blob centroid → lat/lon step rate for hybrid scrub + map marker.
 */

import {
  latLonToRainviewerTileFraction,
  pixelLooksLikeRainEcho,
  RAINVIEWER_NATIVE_Z,
  RAINVIEWER_TILE_PX,
  tilePixelToLatLon,
} from './rainviewer-tile-math';

export type TimedRadarPath = { path: string; time: number };

export type RainCellCentroid = {
  lat: number;
  lon: number;
  /** Dominant blob area in downsampled cells (≈128² grid) */
  areaCells: number;
  /** Mean echo strength 0…1 on blob */
  strength: number;
};

export type RainCellMotion = {
  dLatPerSec: number;
  dLonPerSec: number;
  /** Initial bearing 0°=N, 90°=E — direction the cell centroid moved */
  directionToDeg: number;
  /** Ground speed between centroids (m/s) */
  speedMps: number;
  dtSec: number;
  /** 0…1 from blob size + successful pair */
  confidence: number;
};

const DS = 4;
const DS_DIM = RAINVIEWER_TILE_PX / DS;

type CacheEntry = RainCellCentroid & { cachedAt: number };

const centroidCache = new Map<string, CacheEntry>();
const CACHE_MAX = 24;

function cacheSet(key: string, v: RainCellCentroid) {
  if (centroidCache.size >= CACHE_MAX) {
    const first = centroidCache.keys().next().value as string | undefined;
    if (first) centroidCache.delete(first);
  }
  centroidCache.set(key, { ...v, cachedAt: Date.now() });
}

function cacheGet(key: string): RainCellCentroid | null {
  const e = centroidCache.get(key);
  if (!e) return null;
  return { lat: e.lat, lon: e.lon, areaCells: e.areaCells, strength: e.strength };
}

/** Initial bearing from (lat1,lon1) toward (lat2,lon2), degrees 0=N, 90=E. */
export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dφ = ((bLat - aLat) * Math.PI) / 180;
  const dλ = ((bLon - aLon) * Math.PI) / 180;
  const φ1 = (aLat * Math.PI) / 180;
  const φ2 = (bLat * Math.PI) / 180;
  const s =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function buildMask128(data: Uint8ClampedArray): Uint8Array {
  const w = RAINVIEWER_TILE_PX;
  const mask = new Uint8Array(DS_DIM * DS_DIM);
  let i = 0;
  for (let gj = 0; gj < DS_DIM; gj++) {
    const iy = Math.min(w - 1, gj * DS + Math.floor(DS / 2));
    for (let gi = 0; gi < DS_DIM; gi++) {
      const ix = Math.min(w - 1, gi * DS + Math.floor(DS / 2));
      const p = (iy * w + ix) * 4;
      if (pixelLooksLikeRainEcho(data[p]!, data[p + 1]!, data[p + 2]!, data[p + 3]!)) {
        mask[i] = 1;
      }
      i++;
    }
  }
  return mask;
}

function largestBlobCentroidGrid(
  mask: Uint8Array,
  gw: number,
  gh: number,
  data: Uint8ClampedArray,
): { sumI: number; sumJ: number; count: number; strengthSum: number } | null {
  const visited = new Uint8Array(mask.length);
  let best: { sumI: number; sumJ: number; count: number; strengthSum: number } | null = null;

  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const start = j * gw + i;
      if (!mask[start] || visited[start]) continue;

      const q: number[] = [start];
      visited[start] = 1;
      let sumI = 0;
      let sumJ = 0;
      let count = 0;
      let strengthSum = 0;

      for (let qi = 0; qi < q.length; qi++) {
        const c = q[qi]!;
        const y = Math.floor(c / gw);
        const x = c % gw;
        sumI += x;
        sumJ += y;
        count++;

        const ix = Math.min(RAINVIEWER_TILE_PX - 1, x * DS + Math.floor(DS / 2));
        const iy = Math.min(RAINVIEWER_TILE_PX - 1, y * DS + Math.floor(DS / 2));
        const p = (iy * RAINVIEWER_TILE_PX + ix) * 4;
        const r = data[p]!;
        const g = data[p + 1]!;
        const b = data[p + 2]!;
        const a = data[p + 3]!;
        if (pixelLooksLikeRainEcho(r, g, b, a)) {
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          strengthSum += Math.min(1, (maxC - minC) / 255 + (1 - (r + g + b) / (3 * 255)) * 0.5);
        }

        if (x > 0) {
          const nc = c - 1;
          if (mask[nc] && !visited[nc]) {
            visited[nc] = 1;
            q.push(nc);
          }
        }
        if (x < gw - 1) {
          const nc = c + 1;
          if (mask[nc] && !visited[nc]) {
            visited[nc] = 1;
            q.push(nc);
          }
        }
        if (y > 0) {
          const nc = c - gw;
          if (mask[nc] && !visited[nc]) {
            visited[nc] = 1;
            q.push(nc);
          }
        }
        if (y < gh - 1) {
          const nc = c + gw;
          if (mask[nc] && !visited[nc]) {
            visited[nc] = 1;
            q.push(nc);
          }
        }
      }

      if (!best || count > best.count) {
        best = { sumI, sumJ, count, strengthSum };
      }
    }
  }

  return best;
}

function imageDataCentroid(
  data: Uint8ClampedArray,
): { cx: number; cy: number; areaCells: number; strength: number } | null {
  const mask = buildMask128(data);
  const blob = largestBlobCentroidGrid(mask, DS_DIM, DS_DIM, data);
  if (!blob || blob.count < 8) return null;

  const cx = (blob.sumI / blob.count + 0.5) * DS;
  const cy = (blob.sumJ / blob.count + 0.5) * DS;
  const strength = blob.count > 0 ? blob.strengthSum / blob.count : 0;
  return { cx, cy, areaCells: blob.count, strength };
}

async function loadFrameImageData(
  framePath: string,
  refLat: number,
  refLon: number,
  signal?: AbortSignal,
): Promise<{ data: Uint8ClampedArray; xTile: number; yTile: number } | null> {
  if (typeof window === 'undefined') return null;
  const clean = framePath.replace(/^\//, '');
  const { xTile, yTile } = latLonToRainviewerTileFraction(
    refLat,
    refLon,
    RAINVIEWER_NATIVE_Z,
  );
  const url = `/api/radar/${clean}/512/${RAINVIEWER_NATIVE_Z}/${xTile}/${yTile}/2/1_1.png`;
  let bmp: ImageBitmap | undefined;
  try {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = RAINVIEWER_TILE_PX;
    canvas.height = RAINVIEWER_TILE_PX;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const im = ctx.getImageData(0, 0, RAINVIEWER_TILE_PX, RAINVIEWER_TILE_PX);
    return { data: im.data, xTile, yTile };
  } catch {
    return null;
  } finally {
    bmp?.close();
  }
}

/**
 * Dominant echo centroid in WGS84 for the tile under `refLat`/`refLon`.
 */
export async function centroidLatLonForFrame(
  framePath: string,
  refLat: number,
  refLon: number,
  signal?: AbortSignal,
): Promise<RainCellCentroid | null> {
  const key = `${framePath}|${refLat.toFixed(3)}|${refLon.toFixed(3)}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const loaded = await loadFrameImageData(framePath, refLat, refLon, signal);
  if (!loaded) return null;
  const { data, xTile, yTile } = loaded;
  const c = imageDataCentroid(data);
  if (!c) return null;

  const { lat, lon } = tilePixelToLatLon(xTile, yTile, c.cx, c.cy, RAINVIEWER_NATIVE_Z);
  const out: RainCellCentroid = {
    lat,
    lon,
    areaCells: c.areaCells,
    strength: c.strength,
  };
  cacheSet(key, out);
  return out;
}

function confidenceFromAreas(a: number, b: number): number {
  const m = Math.min(a, b);
  const t = 28;
  const c = Math.min(1, m / t) * Math.min(1, Math.sqrt(m / t));
  return Math.max(0, Math.min(1, c));
}

/**
 * Compare consecutive nowcast frames: largest-echo centroid motion → velocity.
 */
export async function calculateRainCellMovement(
  nowcastFrames: TimedRadarPath[],
  refLat: number,
  refLon: number,
  signal?: AbortSignal,
): Promise<RainCellMotion | null> {
  const sorted = [...(nowcastFrames ?? [])].filter((f) => f?.path && Number.isFinite(f.time));
  sorted.sort((a, b) => a.time - b.time);
  if (sorted.length < 2) return null;

  const a = sorted[sorted.length - 2]!;
  const b = sorted[sorted.length - 1]!;
  const dtSec = Math.max(30, b.time - a.time);

  const [ca, cb] = await Promise.all([
    centroidLatLonForFrame(a.path, refLat, refLon, signal),
    centroidLatLonForFrame(b.path, refLat, refLon, signal),
  ]);
  if (signal?.aborted) return null;
  if (!ca || !cb) return null;

  const dLat = cb.lat - ca.lat;
  const dLon = cb.lon - ca.lon;
  const distM = haversineM(ca.lat, ca.lon, cb.lat, cb.lon);
  if (distM < 80) {
    const c = confidenceFromAreas(ca.areaCells, cb.areaCells) * 0.35;
    if (c < 0.08) return null;
    return {
      dLatPerSec: dLat / dtSec,
      dLonPerSec: dLon / dtSec,
      directionToDeg: bearingDeg(ca.lat, ca.lon, cb.lat, cb.lon),
      speedMps: distM / dtSec,
      dtSec,
      confidence: c,
    };
  }

  return {
    dLatPerSec: dLat / dtSec,
    dLonPerSec: dLon / dtSec,
    directionToDeg: bearingDeg(ca.lat, ca.lon, cb.lat, cb.lon),
    speedMps: distM / dtSec,
    dtSec,
    confidence: confidenceFromAreas(ca.areaCells, cb.areaCells),
  };
}

/**
 * Extrapolate centroid from `frameTimeSec` to `targetUtcSec` using motion rates.
 */
export function extrapolateRainCellLatLon(
  anchorLat: number,
  anchorLon: number,
  frameTimeSec: number,
  targetUtcSec: number,
  motion: RainCellMotion | null,
): { lat: number; lon: number } {
  if (!motion || motion.confidence < 0.06) {
    return { lat: anchorLat, lon: anchorLon };
  }
  const dt = targetUtcSec - frameTimeSec;
  return {
    lat: anchorLat + motion.dLatPerSec * dt,
    lon: anchorLon + motion.dLonPerSec * dt,
  };
}

/**
 * Whether advection is toward the pin (rain approaching) vs away, from cell position at target time.
 */
export function cellMotionTrendVsPin(
  motion: RainCellMotion | null,
  pinLat: number,
  pinLon: number,
  cellLat: number,
  cellLon: number,
): 'in' | 'out' | 'flat' {
  if (!motion || motion.confidence < 0.12) return 'flat';
  const toPin = bearingDeg(cellLat, cellLon, pinLat, pinLon);
  let diff = motion.directionToDeg - toPin;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  if (Math.abs(diff) <= 52) return 'in';
  if (Math.abs(diff) >= 128) return 'out';
  return 'flat';
}
