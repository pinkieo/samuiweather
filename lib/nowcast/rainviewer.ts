/**
 * Live RainViewer fetch: catalog -> z7 tile (99/60) per past frame -> decoded dBZ frames.
 * Never invents data: any frame that cannot be fetched/decoded is skipped and reported; the caller decides
 * whether enough real frames remain.
 */
import { PNG } from 'pngjs';
import * as C from './config';
import { decodeRgba, type Frame } from './frames';

export interface CatalogFrame {
  time: number;
  path: string;
}

export interface Catalog {
  host: string;
  generated: number | null;
  past: CatalogFrame[];
}

export class UpstreamError extends Error {
  constructor(
    public code: 'catalog_failed' | 'catalog_invalid' | 'no_frames',
    message: string,
  ) {
    super(message);
  }
}

async function getWithRetry(url: string, timeoutMs: number, retries = 1): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': C.USER_AGENT },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchCatalog(): Promise<Catalog> {
  let json: unknown;
  try {
    const res = await getWithRetry(C.RAINVIEWER_CATALOG_URL, 8000);
    json = await res.json();
  } catch (e) {
    throw new UpstreamError('catalog_failed', `RainViewer catalog fetch failed: ${(e as Error).message}`);
  }
  const j = json as { host?: unknown; generated?: unknown; radar?: { past?: unknown } };
  const past = j?.radar?.past;
  if (!Array.isArray(past)) throw new UpstreamError('catalog_invalid', 'RainViewer catalog has no radar.past list');
  const frames: CatalogFrame[] = [];
  for (const f of past as Array<{ time?: unknown; path?: unknown }>) {
    if (typeof f?.time === 'number' && typeof f?.path === 'string' && /^\/v2\/radar\/[\w-]+$/.test(f.path)) {
      frames.push({ time: f.time, path: f.path });
    }
  }
  frames.sort((a, b) => a.time - b.time);
  if (!frames.length) throw new UpstreamError('no_frames', 'RainViewer catalog lists no past radar frames');
  // The host is only ever used for tiles; accept the documented host only.
  const host = typeof j.host === 'string' && j.host === C.RAINVIEWER_HOST ? j.host : C.RAINVIEWER_HOST;
  return { host, generated: typeof j.generated === 'number' ? j.generated : null, past: frames };
}

/** Decode a PNG tile buffer to a uint8 q frame (dBZ+32, 0 = no echo). Throws on anything unexpected. */
export function pngToQ(buf: Buffer | Uint8Array): Uint8Array {
  const png = PNG.sync.read(Buffer.from(buf));
  if (png.width !== C.TILE || png.height !== C.TILE) throw new Error(`unexpected tile size ${png.width}x${png.height}`);
  return decodeRgba(png.data, png.width, png.height);
}

export function tileUrl(host: string, path: string): string {
  return `${host}${path}/${C.TILE}/${C.Z}/${C.TILE_X}/${C.TILE_Y}/${C.COLOR_SCHEME}/${C.TILE_OPTS}.png`;
}

// Decoded frames are immutable per timestamp: keep the most recent ones between requests.
const frameCache = new Map<number, Frame>();
const FRAME_CACHE_MAX = 24;

export interface LoadedFrames {
  frames: Frame[];
  catalog: Catalog;
  failed: number[];
}

/** Fetch every catalog past frame (cached by timestamp). */
export async function loadFrames(): Promise<LoadedFrames> {
  const catalog = await fetchCatalog();
  const failed: number[] = [];
  const frames = await Promise.all(
    catalog.past.map(async (f): Promise<Frame | null> => {
      const hit = frameCache.get(f.time);
      if (hit) return hit;
      try {
        const res = await getWithRetry(tileUrl(catalog.host, f.path), 10000);
        const q = pngToQ(new Uint8Array(await res.arrayBuffer()));
        const fr: Frame = { t: f.time, q };
        frameCache.set(f.time, fr);
        return fr;
      } catch {
        failed.push(f.time);
        return null;
      }
    }),
  );
  const keep = new Set(catalog.past.map((f) => f.time));
  for (const k of [...frameCache.keys()]) if (!keep.has(k)) frameCache.delete(k);
  while (frameCache.size > FRAME_CACHE_MAX) frameCache.delete(frameCache.keys().next().value as number);
  return { frames: frames.filter((f): f is Frame => f !== null).sort((a, b) => a.t - b.t), catalog, failed: failed.sort() };
}
