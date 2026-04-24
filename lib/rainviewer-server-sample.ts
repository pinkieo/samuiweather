/**
 * Server-side RainViewer tile sample — same z7/512 grid as the map overlay.
 * Used by `/api/conflict-status` so “mainland radar” reflects real echoes, not SPIRE precip alone.
 */

import { inflateSync } from 'node:zlib';
import {
  echoPixelStrength01,
  latLonToRainviewerTileFraction,
  pixelLooksLikeRainEcho,
  RAINVIEWER_NATIVE_Z,
  webMercatorMetersPerPixel,
} from './rainviewer-tile-math';
import type { RadarStatus } from './sammi-post-generator';

export type TilePrecipSample = 'none' | 'precip' | 'unknown';

/** Krabi: max echo strength in a disc around the pin, mapped to copy + {@link mergeLandRadarVerdictKrabi}. */
export type RadarEchoTier = 'light' | 'medium' | 'heavy' | 'storm';

export type KrabiPinEcho =
  | { kind: 'none' }
  | { kind: 'unknown' }
  | { kind: 'echo'; tier: RadarEchoTier; maxStrength01: number; radiusKm: number; perimeterKm: number };

function readU32BE(u8: Uint8Array, o: number): number {
  return (
    ((u8[o] ?? 0) << 24) |
    ((u8[o + 1] ?? 0) << 16) |
    ((u8[o + 2] ?? 0) << 8) |
    (u8[o + 3] ?? 0)
  ) >>> 0;
}

function concatChunks(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Full-tile decode: RGBA8 flat `width * height * 4`. Color types 2 (RGB) and 6 (RGBA); interlace 0 only. */
function decodeRainviewerPngToRgba(u8: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null {
  if (u8.length < 24 || u8[0] !== 0x89) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= u8.length) {
    const len = readU32BE(u8, pos);
    const t0 = u8[pos + 4]!;
    const t1 = u8[pos + 5]!;
    const t2 = u8[pos + 6]!;
    const t3 = u8[pos + 7]!;
    const dataStart = pos + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > u8.length) return null;
    if (t0 === 73 && t1 === 72 && t2 === 68 && t3 === 82 && len >= 13) {
      width = readU32BE(u8, dataStart);
      height = readU32BE(u8, dataStart + 4);
      bitDepth = u8[dataStart + 8]!;
      colorType = u8[dataStart + 9]!;
      interlace = u8[dataStart + 12]!;
    } else if (t0 === 73 && t1 === 68 && t2 === 65 && t3 === 84) {
      idat.push(u8.subarray(dataStart, dataEnd));
    } else if (t0 === 73 && t1 === 69 && t2 === 78 && t3 === 68) break;
    pos = dataEnd + 4;
  }
  if (width === 0 || height === 0 || bitDepth !== 8 || interlace !== 0) return null;
  if (colorType !== 2 && colorType !== 6) return null;

  const bpp = colorType === 6 ? 4 : 3;
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(inflateSync(concatChunks(idat)));
  } catch {
    return null;
  }
  const stride = 1 + width * bpp;
  if (raw.length < height * stride) return null;

  const out = new Uint8Array(width * height * 4);
  const cur = new Uint8Array(width * bpp);
  const prev = new Uint8Array(width * bpp);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride]!;
    const src = raw.subarray(y * stride + 1, y * stride + 1 + width * bpp);
    for (let i = 0; i < width * bpp; i++) {
      let v = src[i]!;
      const left = i >= bpp ? cur[i - bpp]! : 0;
      const up = prev[i]!;
      const upLeft = i >= bpp ? prev[i - bpp]! : 0;
      if (filter === 0) {
        /* none */
      } else if (filter === 1) v = (v + left) & 255;
      else if (filter === 2) v = (v + up) & 255;
      else if (filter === 3) v = (v + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) v = (v + paeth(left, up, upLeft)) & 255;
      else return null;
      cur[i] = v;
    }
    const rowBase = y * width * 4;
    if (colorType === 6) {
      for (let x = 0; x < width; x++) {
        const si = x * 4;
        out[rowBase + si] = cur[si]!;
        out[rowBase + si + 1] = cur[si + 1]!;
        out[rowBase + si + 2] = cur[si + 2]!;
        out[rowBase + si + 3] = cur[si + 3]!;
      }
    } else {
      for (let x = 0; x < width; x++) {
        const si = x * 3;
        out[rowBase + x * 4] = cur[si]!;
        out[rowBase + x * 4 + 1] = cur[si + 1]!;
        out[rowBase + x * 4 + 2] = cur[si + 2]!;
        out[rowBase + x * 4 + 3] = 255;
      }
    }
    prev.set(cur);
  }

  return { width, height, rgba: out };
}

export async function fetchLatestRainViewerFramePath(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      headers: { 'User-Agent': 'SamuiWeatherDashboard/1.0' },
      signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const past =
      typeof data === 'object' &&
      data !== null &&
      'radar' in data &&
      typeof (data as { radar?: { past?: unknown } }).radar === 'object' &&
      (data as { radar?: { past?: unknown } }).radar !== null
        ? ((data as { radar: { past?: { path: string; time: number }[] } }).radar.past ?? [])
        : [];
    const list = Array.isArray(past) ? past : [];
    if (list.length === 0) return null;
    const sorted = [...list].sort((a, b) => a.time - b.time);
    const last = sorted[sorted.length - 1]!;
    return typeof last?.path === 'string' ? last.path : null;
  } catch {
    return null;
  }
}

function scanNeighbourhoodForEcho(
  rgba: Uint8Array,
  width: number,
  height: number,
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
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) continue;
      const o = (iy * width + ix) * 4;
      if (pixelLooksLikeRainEcho(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!, rgba[o + 3]!)) return true;
    }
  }
  return false;
}

/** Perimeter ≈ 10 km → circle radius = C / (2π) ≈ 1.59 km (Ao Nang pin sampling disc). */
export const KRABI_PIN_CIRCUMFERENCE_KM = 10 as const;

function ringRadiusMFromPerimeterKm(perimeterKm: number): number {
  return (perimeterKm * 1000) / (2 * Math.PI);
}

function echoTierFromMaxStrength01(s: number): RadarEchoTier {
  if (s < 0.2) return 'light';
  if (s < 0.38) return 'medium';
  if (s < 0.58) return 'heavy';
  return 'storm';
}

/**
 * Max echo strength in a circle (pixel disc) on one decoded tile. Returns `null` if no echo.
 */
function scanDiscMaxEchoStrength01(
  rgba: Uint8Array,
  width: number,
  height: number,
  fx: number,
  fy: number,
  half: number,
): number | null {
  const r2 = half * half;
  let maxS = 0;
  let any = false;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const ix = Math.round(fx + dx);
      const iy = Math.round(fy + dy);
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) continue;
      const o = (iy * width + ix) * 4;
      const s = echoPixelStrength01(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!, rgba[o + 3]!);
      if (s > 0) {
        any = true;
        if (s > maxS) maxS = s;
      }
    }
  }
  return any ? maxS : null;
}

/**
 * Krabi: one tile, Doppler in a disc around the pin with perimeter ≈ {@link KRABI_PIN_CIRCUMFERENCE_KM} km.
 * No multi-tile sweep — only echo in this “local” ring counts for conflict / banner.
 */
export async function sampleKrabiRadarAtPin(
  lat: number,
  lon: number,
  framePath: string,
  signal: AbortSignal | undefined,
  perimeterKm: number = KRABI_PIN_CIRCUMFERENCE_KM,
): Promise<KrabiPinEcho> {
  const clean = framePath.replace(/^\//, '');
  const mpp = webMercatorMetersPerPixel(lat, RAINVIEWER_NATIVE_Z, 512);
  const radiusM = ringRadiusMFromPerimeterKm(perimeterKm);
  const half = Math.max(1, Math.ceil((radiusM / mpp) * 1.25));

  const { xTile, yTile, fx, fy } = latLonToRainviewerTileFraction(lat, lon, RAINVIEWER_NATIVE_Z);
  const url = `https://tilecache.rainviewer.com/${clean}/512/${RAINVIEWER_NATIVE_Z}/${xTile}/${yTile}/2/1_1.png`;
  try {
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'SamuiWeatherDashboard/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) return { kind: 'unknown' };
    const buf = new Uint8Array(await res.arrayBuffer());
    const decoded = decodeRainviewerPngToRgba(buf);
    if (!decoded) return { kind: 'unknown' };
    const { width, height, rgba } = decoded;
    const maxS = scanDiscMaxEchoStrength01(rgba, width, height, fx, fy, half);
    if (maxS == null) return { kind: 'none' };
    return {
      kind: 'echo',
      tier: echoTierFromMaxStrength01(maxS),
      maxStrength01: maxS,
      radiusKm: radiusM / 1000,
      perimeterKm,
    };
  } catch {
    if (signal?.aborted) return { kind: 'unknown' };
    return { kind: 'unknown' };
  }
}

/**
 * Fetch the 512×z7 tile and sample a small neighbourhood at lat/lon (RainViewer scheme 2).
 */
export async function sampleRainViewerTileAtLocation(
  lat: number,
  lon: number,
  framePath: string,
  signal?: AbortSignal,
): Promise<TilePrecipSample> {
  const clean = framePath.replace(/^\//, '');
  const { xTile, yTile, fx, fy } = latLonToRainviewerTileFraction(lat, lon, RAINVIEWER_NATIVE_Z);
  const url = `https://tilecache.rainviewer.com/${clean}/512/${RAINVIEWER_NATIVE_Z}/${xTile}/${yTile}/2/1_1.png`;
  try {
    const res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'SamuiWeatherDashboard/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) return 'unknown';
    const buf = new Uint8Array(await res.arrayBuffer());
    const decoded = decodeRainviewerPngToRgba(buf);
    if (!decoded) return 'unknown';
    const { width, height, rgba } = decoded;
    if (scanNeighbourhoodForEcho(rgba, width, height, fx, fy, 6)) return 'precip';
    return 'none';
  } catch {
    if (signal?.aborted) return 'unknown';
    return 'unknown';
  }
}

/**
 * Coast / island: cells often sit tens of km from the villa pin while still filling the same map view.
 * Sample a wide disc on the pin tile, then repeat at offset lat/lon (new tile when needed). Tiles are
 * cached by URL so overlapping offsets only decode once.
 */
export async function sampleRainViewerPrecipNearPin(
  lat: number,
  lon: number,
  framePath: string,
  signal: AbortSignal | undefined,
  product: 'krabi' | 'samui',
): Promise<TilePrecipSample> {
  const clean = framePath.replace(/^\//, '');
  /** ~25–45 km steps — enough to catch training cells N/NE of Ao Nang without flagging Phuket every time. */
  const offsetDeg: [number, number][] =
    product === 'krabi'
      ? [
          [0, 0],
          [0.32, 0],
          [0.22, 0],
          [0.42, 0],
          [-0.12, 0],
          [0.18, 0.16],
          [0.18, -0.16],
          [0.28, 0.12],
          [0.28, -0.12],
          [0, 0.18],
          [0, -0.15],
          [0.08, 0.22],
        ]
      : [
          [0, 0],
          [0.1, 0],
          [-0.08, 0],
          [0, 0.1],
          [0, -0.1],
          [0.12, 0.08],
          [0.12, -0.08],
        ];

  const halfPx = product === 'krabi' ? 118 : 78;
  const cache = new Map<string, { width: number; height: number; rgba: Uint8Array }>();
  let anyUnknown = false;

  for (const [dLat, dLon] of offsetDeg) {
    const la = lat + dLat;
    const lo = lon + dLon;
    const { xTile, yTile, fx, fy } = latLonToRainviewerTileFraction(la, lo, RAINVIEWER_NATIVE_Z);
    const url = `https://tilecache.rainviewer.com/${clean}/512/${RAINVIEWER_NATIVE_Z}/${xTile}/${yTile}/2/1_1.png`;

    let decoded = cache.get(url);
    if (!decoded) {
      try {
        const res = await fetch(url, {
          signal,
          headers: { 'User-Agent': 'SamuiWeatherDashboard/1.0' },
          cache: 'no-store',
        });
        if (!res.ok) {
          anyUnknown = true;
          continue;
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        const d = decodeRainviewerPngToRgba(buf);
        if (!d) {
          anyUnknown = true;
          continue;
        }
        decoded = d;
        cache.set(url, d);
      } catch {
        if (signal?.aborted) return 'unknown';
        anyUnknown = true;
        continue;
      }
    }

    if (scanNeighbourhoodForEcho(decoded.rgba, decoded.width, decoded.height, fx, fy, halfPx)) {
      return 'precip';
    }
  }

  return anyUnknown ? 'unknown' : 'none';
}

/**
 * Merge SPIRE-derived “radar” (legacy) with a real tile sample.
 * If the tile shows precip while SPIRE is dry, upgrade to `light_rain` so {@link resolveWeatherConflict} can
 * note a mismatch without claiming a full “active rain” band; see route `isAlert` rules.
 */
export function mergeLandRadarVerdict(
  spirePrecipRadar: RadarStatus,
  tile: TilePrecipSample,
): RadarStatus {
  if (tile === 'unknown') return spirePrecipRadar;
  if (tile === 'none') return spirePrecipRadar;
  if (spirePrecipRadar === 'storm') return 'storm';
  if (spirePrecipRadar === 'rain') return 'rain';
  if (spirePrecipRadar === 'light_rain') return 'light_rain';
  /**
   * Doppler in view but models dry — treat as **light scatter** only. Classifying as full `rain`
   * was firing “rain alert” for offshore specks or sea clutter while the pin stayed clear.
   * @see `sampleRainViewerTileAtLocation` (pin-tight) vs `sampleRainViewerPrecipNearPin` (wide ring).
   */
  return 'light_rain';
}

/**
 * Map Krabi pin-echo + SPIRE to {@link RadarStatus} (4-way) for `resolveWeatherConflict`.
 */
export function mergeLandRadarVerdictKrabi(
  spirePrecipRadar: RadarStatus,
  pin: KrabiPinEcho,
): RadarStatus {
  if (pin.kind === 'unknown') return spirePrecipRadar;
  if (pin.kind === 'none') return spirePrecipRadar;
  if (spirePrecipRadar === 'storm') return 'storm';
  if (spirePrecipRadar === 'rain') return 'rain';
  if (spirePrecipRadar === 'light_rain') return 'light_rain';
  const t = pin.tier;
  if (t === 'light') return 'light_rain';
  if (t === 'medium' || t === 'heavy') return 'rain';
  if (t === 'storm') return 'storm';
  return spirePrecipRadar;
}
