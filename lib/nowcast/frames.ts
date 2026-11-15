/** Frame type + RainViewer colour -> dBZ decoding (port of snw/rvfetch.py decode section). */
import * as C from './config';
import { UNIVERSAL_BLUE } from './palette';

/** One decoded radar frame: q = dBZ + 32 as uint8 (0 = no echo / transparent), row-major TILE x TILE. */
export interface Frame {
  /** Frame time, unix seconds UTC. */
  t: number;
  q: Uint8Array;
  /** Set by uniqueFrames(): how many published frames this scan covers. */
  nCopies?: number;
  lastCopyT?: number;
}

const KEY = new Map<number, number>();
for (const [dbz, r, g, b, a] of UNIVERSAL_BLUE) KEY.set(((r * 256 + g) * 256 + b) * 256 + a, dbz);

function nearestDbz(r: number, g: number, b: number, a: number): number {
  let best = Infinity;
  let out = UNIVERSAL_BLUE[0][0];
  for (const [dbz, pr, pg, pb, pa] of UNIVERSAL_BLUE) {
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2 + 0.3 * (pa - a) ** 2;
    if (d < best) {
      best = d;
      out = dbz;
    }
  }
  return out;
}

/** RGBA (w*h*4) -> uint8 q = dBZ+32 (0 = no echo/transparent). */
export function decodeRgba(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const cache = new Map<number, number>();
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3];
    if (a === 0) continue;
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const key = ((r * 256 + g) * 256 + b) * 256 + a;
    let v = KEY.get(key) ?? cache.get(key);
    if (v === undefined) {
      v = nearestDbz(r, g, b, a);
      cache.set(key, v);
    }
    out[i] = v + 32;
  }
  return out;
}

/** dBZ at pixel index, or NaN where no echo (mirrors q_to_dbz). */
export function qToDbz(q: Uint8Array): Float32Array {
  const d = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) d[i] = q[i] === 0 ? NaN : q[i] - 32;
  return d;
}

export const N_PX = C.TILE * C.TILE;
