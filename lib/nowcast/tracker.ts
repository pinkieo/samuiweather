/**
 * Frame de-duplication, motion estimation (whole-field + per-cell TREC) and frame-to-frame cell tracking.
 * Port of snw/tracker.py. Per-cell only: velocities come from each cell's own track, its echo pattern and a
 * whole-field prior — never from an all-rain centroid.
 */
import * as C from './config';
import * as geo from './geo';
import { detect, type Cell } from './cells';
import type { Frame } from './frames';

const W = C.TILE;

// ---------- unique frames -------------------------------------------------------------------
/**
 * True if b is (almost) the same scan as a. Measured on echo pixels only.
 * Genuine new scans change 85-98 % of echo pixels, republished scans 6-18 %.
 */
export function isRepeat(a: Uint8Array, b: Uint8Array, maxDiffFrac = 0.35): boolean {
  let n = 0;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > 0 || b[i] > 0) {
      n++;
      if (a[i] !== b[i]) diff++;
    }
  }
  if (n === 0) return true;
  return diff / n <= maxDiffFrac;
}

/** Drop republished scans; the kept frame keeps the *first* timestamp. */
export function uniqueFrames(frames: Frame[]): Frame[] {
  const out: Frame[] = [];
  for (const f of [...frames].sort((x, y) => x.t - y.t)) {
    if (out.length && isRepeat(out[out.length - 1].q, f.q)) {
      const last = out[out.length - 1];
      last.nCopies = (last.nCopies ?? 1) + 1;
      last.lastCopyT = f.t;
      continue;
    }
    out.push({ ...f, nCopies: 1, lastCopyT: f.t });
  }
  return out;
}

// ---------- motion --------------------------------------------------------------------------
/** clip(dbz - 15, 0, 35); no echo -> 0. */
function field(frame: Frame): Float64Array {
  const out = new Float64Array(W * W);
  const q = frame.q;
  for (let i = 0; i < q.length; i++) {
    if (q[i] === 0) continue;
    const v = q[i] - 32 - 15;
    out[i] = v < 0 ? 0 : v > 35 ? 35 : v;
  }
  return out;
}

/** Sub-pixel peak refinement on a 3x3 patch; c is (n x n) row-major. */
function quadfit(c: Float64Array, n: number, i: number, j: number): [number, number] {
  const p = (a: number, b: number, cc: number) => {
    const den = a - 2 * b + cc;
    return Math.abs(den) < 1e-9 ? 0.0 : (0.5 * (a - cc)) / den;
  };
  const at = (y: number, x: number) => c[y * n + x];
  return [p(at(i, j - 1), at(i, j), at(i, j + 1)), p(at(i - 1, j), at(i, j), at(i + 1, j))];
}

export interface Motion {
  vx: number;
  vy: number;
  score: number;
  t?: number;
}

/**
 * Whole-field displacement f0 -> f1 by (mean-removed, zero-padded) cross-correlation over the context box.
 * Direct evaluation is mathematically identical to the prototype's zero-padded FFT correlation.
 */
export function globalMotion(f0: Frame, f1: Frame, box = C.CONTEXT): Motion | null {
  const { y0, y1, x0, x1 } = geo.boxPx(box);
  const h = y1 - y0;
  const w = x1 - x0;
  const fa = field(f0);
  const fb = field(f1);
  const a = new Float64Array(h * w);
  const b = new Float64Array(h * w);
  let sa = 0;
  let sb = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const va = fa[(y0 + y) * W + x0 + x];
      const vb = fb[(y0 + y) * W + x0 + x];
      a[y * w + x] = va;
      b[y * w + x] = vb;
      sa += va;
      sb += vb;
    }
  }
  if (sa < 50 || sb < 50) return null;
  const dtH = (f1.t - f0.t) / 3600.0;
  const R = Math.trunc(Math.min(20, Math.ceil((C.MAX_SPEED_KMH * dtH) / geo.KMPX)));
  const ma = sa / (h * w);
  const mb = sb / (h * w);
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    a[i] -= ma;
    b[i] -= mb;
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const n = 2 * R + 1;
  const sub = new Float64Array(n * n);
  for (let iy = 0; iy < n; iy++) {
    const sy = iy - R;
    const ya = Math.max(0, -sy);
    const yb = Math.min(h, h - sy);
    for (let ix = 0; ix < n; ix++) {
      const sx = ix - R;
      const xa = Math.max(0, -sx);
      const xb = Math.min(w, w - sx);
      let s = 0;
      for (let y = ya; y < yb; y++) {
        const ra = y * w;
        const rb = (y + sy) * w + sx;
        for (let x = xa; x < xb; x++) s += a[ra + x] * b[rb + x];
      }
      sub[iy * n + ix] = s;
    }
  }
  const norm = Math.sqrt(na * nb) + 1e-9;
  let best = -Infinity;
  let bi = 0;
  for (let i = 0; i < sub.length; i++) {
    sub[i] /= norm;
    if (sub[i] > best) {
      best = sub[i];
      bi = i;
    }
  }
  const iy = Math.floor(bi / n);
  const ix = bi % n;
  let dxS = 0;
  let dyS = 0;
  if (iy > 0 && iy < 2 * R && ix > 0 && ix < 2 * R) [dxS, dyS] = quadfit(sub, n, iy, ix);
  const sx = ix - R + dxS;
  const sy = iy - R + dyS;
  return { vx: (sx * geo.KMPX) / dtH, vy: (-sy * geo.KMPX) / dtH, score: best };
}

/** Per-cell TREC: shift of the cell's own echo pattern (cell pixels dilated by 3 px) cur <- prev. */
export function localMotion(
  prev: Frame,
  cur: Frame,
  cell: Cell,
  pad = 8,
  priorKmh: [number, number] | null = null,
): Motion | null {
  const dtH = (cur.t - prev.t) / 3600.0;
  if (dtH <= 0) return null;
  const R = Math.trunc(Math.min(18, Math.ceil((60.0 * dtH) / geo.KMPX)));
  const A = field(cur);
  const B = field(prev);
  const ps: [number, number] = priorKmh
    ? [(priorKmh[0] * dtH) / geo.KMPX, (-priorKmh[1] * dtH) / geo.KMPX]
    : [0, 0];
  let minx = Infinity;
  let maxx = -Infinity;
  let miny = Infinity;
  let maxy = -Infinity;
  for (let i = 0; i < cell.xs.length; i++) {
    minx = Math.min(minx, cell.xs[i]);
    maxx = Math.max(maxx, cell.xs[i]);
    miny = Math.min(miny, cell.ys[i]);
    maxy = Math.max(maxy, cell.ys[i]);
  }
  const x0 = minx - pad;
  const x1 = maxx + pad + 1;
  const y0 = miny - pad;
  const y1 = maxy + pad + 1;
  // mask = cell pixels dilated 3x with the 4-connected cross (Manhattan radius 3), clipped to the tile
  const m = new Uint8Array(W * W);
  for (let i = 0; i < cell.xs.length; i++) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 3) continue;
        const x = cell.xs[i] + dx;
        const y = cell.ys[i] + dy;
        if (x >= 0 && x < W && y >= 0 && y < W) m[y * W + x] = 1;
      }
    }
  }
  const x0c = Math.max(x0, R);
  const x1c = Math.min(x1, W - R);
  const y0c = Math.max(y0, R);
  const y1c = Math.min(y1, W - R);
  if (x1c - x0c < 4 || y1c - y0c < 4) return null;
  const px: number[] = [];
  const py: number[] = [];
  let tsum = 0;
  let tsq = 0;
  for (let y = y0c; y < y1c; y++) {
    for (let x = x0c; x < x1c; x++) {
      if (m[y * W + x]) {
        px.push(x);
        py.push(y);
        const v = A[y * W + x];
        tsum += v;
        tsq += v * v;
      }
    }
  }
  if (tsum < 5) return null;
  const tn = Math.sqrt(tsq) + 1e-9;
  const n = 2 * R + 1;
  const res = new Float64Array(n * n).fill(-9.0);
  let best = -9;
  let bs: [number, number] = [0, 0];
  const np = px.length;
  const tv = new Float64Array(np);
  for (let i = 0; i < np; i++) tv[i] = A[py[i] * W + px[i]];
  for (let iy = 0; iy < n; iy++) {
    const sy = iy - R;
    for (let ix = 0; ix < n; ix++) {
      const sx = ix - R;
      let dot = 0;
      let cq = 0;
      for (let i = 0; i < np; i++) {
        const c = B[(py[i] - sy) * W + (px[i] - sx)];
        dot += tv[i] * c;
        cq += c * c;
      }
      const cn = Math.sqrt(cq) + 1e-9;
      let s = dot / (tn * cn);
      // regularise toward the whole-field motion so weakly-structured cells cannot jump to a spurious far match
      s -= (0.3 * Math.hypot(sx - ps[0], sy - ps[1])) / Math.max(R, 1);
      res[iy * n + ix] = s;
      if (s > best) {
        best = s;
        bs = [sx, sy];
      }
    }
  }
  const iy = bs[1] + R;
  const ix = bs[0] + R;
  let dxS = 0;
  let dyS = 0;
  if (iy > 0 && iy < 2 * R && ix > 0 && ix < 2 * R) {
    let mn = Infinity;
    for (let yy = iy - 1; yy <= iy + 1; yy++) for (let xx = ix - 1; xx <= ix + 1; xx++) mn = Math.min(mn, res[yy * n + xx]);
    if (mn > -9) [dxS, dyS] = quadfit(res, n, iy, ix);
  }
  const sx = bs[0] + dxS;
  const sy = bs[1] + dyS;
  return { vx: (sx * geo.KMPX) / dtH, vy: (-sy * geo.KMPX) / dtH, score: best };
}

// ---------- tracks --------------------------------------------------------------------------
export interface Trend {
  label: 'growing' | 'decaying' | 'steady' | 'unknown';
  dlnAPerH: number | null;
  ddbzPerH: number | null;
}

export type Vec = [number, number];

export interface Track {
  tid: number;
  cells: Cell[];
  missed: number;
  /** km/h east, north (final estimate). */
  v: Vec;
  vSrc: Record<string, unknown>;
  /** km/h disagreement between estimators. */
  vSpread: number;
  trend: Trend;
  vConf: 'ok' | 'low' | 'none';
}

export const lastCell = (tr: Track): Cell => tr.cells[tr.cells.length - 1];
export const speedOf = (tr: Track): number => Math.hypot(tr.v[0], tr.v[1]);
export const headingOf = (tr: Track): number => (speedOf(tr) > 0.5 ? geo.bearingDeg(tr.v[0], tr.v[1]) : NaN);

function newTrack(tid: number, c: Cell): Track {
  return { tid, cells: [c], missed: 0, v: [0, 0], vSrc: {}, vSpread: 0, trend: { label: 'unknown', dlnAPerH: null, ddbzPerH: null }, vConf: 'none' };
}

/** OLS slope & intercept. */
function polyfit1(t: number[], y: number[]): [number, number] {
  const n = t.length;
  const tm = t.reduce((a, b) => a + b, 0) / n;
  const ym = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (t[i] - tm) * (y[i] - ym);
    sxx += (t[i] - tm) ** 2;
  }
  const slope = sxy / sxx;
  return [slope, ym - slope * tm];
}

function regressVelocity(all: Cell[], maxN = 6): { v: Vec; rms: number } | null {
  const cs = all.slice(-maxN);
  if (cs.length < 3) return null;
  const t0 = cs[0].t;
  const t = cs.map((c) => (c.t - t0) / 3600.0);
  if (t[t.length - 1] < 0.25) return null; // need at least ~15 min baseline
  const E = cs.map((c) => c.eastKm);
  const N = cs.map((c) => c.northKm);
  const [ve, e0] = polyfit1(t, E);
  const [vn, n0] = polyfit1(t, N);
  let s = 0;
  for (let i = 0; i < cs.length; i++) s += (E[i] - (ve * t[i] + e0)) ** 2 + (N[i] - (vn * t[i] + n0)) ** 2;
  return { v: [ve, vn], rms: Math.sqrt(s / cs.length) };
}

export function trendOf(all: Cell[], maxN = 5): Trend {
  const cs = all.slice(-maxN);
  if (cs.length < 3 || cs[cs.length - 1].t - cs[0].t < 1500) return { label: 'unknown', dlnAPerH: null, ddbzPerH: null };
  const t0 = cs[0].t;
  const t = cs.map((c) => (c.t - t0) / 3600.0);
  const a = cs.map((c) => Math.log(c.areaKm2));
  const d = cs.map((c) => c.maxDbz);
  // Round the fitted slopes: integer dBZ data can give a slope of exactly +-3.0 and float noise (1e-10) would otherwise
  // decide which side of the hard threshold it lands on. Same rounding in the Python prototype (round(x, 9)).
  const sa = geo.pyRound(polyfit1(t, a)[0] * 1e9) / 1e9;
  const sd = geo.pyRound(polyfit1(t, d)[0] * 1e9) / 1e9;
  let label: Trend['label'];
  if (sa > 0.35 || sd > 3.0) label = 'growing';
  else if (sa < -0.35 || sd < -3.0) label = 'decaying';
  else label = 'steady';
  return { label, dlnAPerH: sa, ddbzPerH: sd };
}

function overlap(a: Cell, b: Cell, shift: [number, number]): number {
  const sa = new Set<number>();
  for (let i = 0; i < a.xs.length; i++) {
    const x = geo.pyRound(a.xs[i] + shift[0]);
    const y = geo.pyRound(a.ys[i] + shift[1]);
    sa.add((y + 1000) * 4096 + (x + 1000));
  }
  const sb = new Set<number>();
  for (let i = 0; i < b.xs.length; i++) sb.add((b.ys[i] + 1000) * 4096 + (b.xs[i] + 1000));
  let inter = 0;
  for (const k of sa) if (sb.has(k)) inter++;
  const union = sa.size + sb.size - inter;
  return inter / Math.max(1, union);
}

/** Min-cost assignment on an n x m matrix (rows <= cols or not); returns [row, col] pairs (min(n,m) of them). */
export function linearSumAssignment(cost: number[][]): Array<[number, number]> {
  const n0 = cost.length;
  const m0 = n0 ? cost[0].length : 0;
  if (!n0 || !m0) return [];
  const transpose = n0 > m0;
  const n = transpose ? m0 : n0;
  const m = transpose ? n0 : m0;
  const a = (i: number, j: number) => (transpose ? cost[j - 1][i - 1] : cost[i - 1][j - 1]);
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a(i0, j) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out: Array<[number, number]> = [];
  for (let j = 1; j <= m; j++) if (p[j]) out.push(transpose ? [j - 1, p[j] - 1] : [p[j] - 1, j - 1]);
  return out.sort((x, y) => x[0] - y[0]);
}

export interface TrackResult {
  tracks: Track[];
  perFrame: Cell[][];
  globalMotion: Motion[];
  frames: Frame[];
  priorGlobal: Vec | null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Detection + tracking over `framesIn` (chronological, already unique). */
export function buildTracks(framesIn: Frame[], maxMiss = 1): TrackResult {
  const frames = [...framesIn].sort((a, b) => a.t - b.t);
  const perFrame: Cell[][] = [];
  const gm: Motion[] = [];
  const tracks: Track[] = [];
  let active: Track[] = [];
  let nid = 1;
  let priorGlobal: Vec | null = null;
  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i];
    const cs = detect(fr);
    perFrame.push(cs);
    if (i > 0) {
      const m = globalMotion(frames[i - 1], fr);
      if (m) {
        m.t = fr.t;
        gm.push(m);
      }
      const recent = gm.slice(-3).filter((g) => g.score > 0.3);
      if (recent.length) priorGlobal = [median(recent.map((g) => g.vx)), median(recent.map((g) => g.vy))];
    }
    if (i === 0 || !active.length) {
      for (const c of cs) {
        tracks.push(newTrack(nid, c));
        active.push(tracks[tracks.length - 1]);
        nid++;
      }
      continue;
    }
    // predictions
    const preds: Array<{ pv: Vec; dtl: number }> = [];
    for (const tr of active) {
      let pv: Vec = tr.cells.length >= 2 && speedOf(tr) > 0 ? tr.v : (priorGlobal ?? [0, 0]);
      if (tr.cells.length >= 2) {
        const pg = priorGlobal ?? tr.v;
        pv = [0.6 * tr.v[0] + 0.4 * pg[0], 0.6 * tr.v[1] + 0.4 * pg[1]];
      }
      preds.push({ pv, dtl: (fr.t - lastCell(tr).t) / 3600.0 });
    }
    const nA = active.length;
    const nC = cs.length;
    let cost: number[][] = [];
    let pairs: Array<[number, number]> = [];
    if (nC) {
      cost = Array.from({ length: nA }, () => new Array<number>(nC).fill(1e6));
      for (let a = 0; a < nA; a++) {
        const tr = active[a];
        const { pv, dtl } = preds[a];
        const last = lastCell(tr);
        const pe = last.eastKm + pv[0] * dtl;
        const pn = last.northKm + pv[1] * dtl;
        const shift: [number, number] = [(pv[0] * dtl) / geo.KMPX, (-pv[1] * dtl) / geo.KMPX];
        for (let ci = 0; ci < nC; ci++) {
          const c = cs[ci];
          const d = Math.hypot(c.eastKm - pe, c.northKm - pn);
          const gate = 8.0 + 0.5 * Math.hypot(pv[0], pv[1]) * dtl + 0.3 * Math.sqrt(last.areaKm2);
          const iou = d < 2.5 * gate ? overlap(last, c, shift) : 0.0;
          if (d <= gate || iou >= 0.2) cost[a][ci] = d - 15.0 * iou;
        }
      }
      pairs = linearSumAssignment(cost);
    }
    const matchedA = new Set<number>();
    const matchedC = new Set<number>();
    for (const [a, ci] of pairs) {
      if (cost[a][ci] < 1e5) {
        active[a].cells.push(cs[ci]);
        active[a].missed = 0;
        matchedA.add(a);
        matchedC.add(ci);
      }
    }
    active.forEach((tr, a) => {
      if (!matchedA.has(a)) tr.missed += 1;
    });
    active = active.filter((tr) => tr.missed <= maxMiss);
    cs.forEach((c, ci) => {
      if (!matchedC.has(ci)) {
        tracks.push(newTrack(nid, c));
        active.push(tracks[tracks.length - 1]);
        nid++;
      }
    });
    // per-track velocity update (so the next frame's prediction uses it)
    for (const tr of active) {
      if (tr.missed === 0) {
        const r = regressVelocity(tr.cells);
        if (r) tr.v = r.v;
        else if (tr.cells.length >= 2 && lastCell(tr).t > tr.cells[tr.cells.length - 2].t) {
          const a = lastCell(tr);
          const b = tr.cells[tr.cells.length - 2];
          const dtt = (a.t - b.t) / 3600.0;
          tr.v = [(a.eastKm - b.eastKm) / dtt, (a.northKm - b.northKm) / dtt];
        }
      }
    }
  }
  return { tracks, perFrame, globalMotion: gm, frames, priorGlobal };
}

/**
 * For every track alive at the newest frame, combine track regression / local TREC / whole-field motion.
 * >=3 candidates: component-wise median. 2: weighted mean. Spread = largest disagreement (km/h).
 * Short-lived or tiny cells fall back to the whole-field motion.
 */
export function finalizeVelocities(res: TrackResult): void {
  const frames = res.frames;
  const cur = frames[frames.length - 1];
  const pg = res.priorGlobal;
  for (const tr of res.tracks) {
    if (!tr.cells.length || lastCell(tr).t !== cur.t) continue;
    const est: Vec[] = [];
    const w: number[] = [];
    const src: Record<string, { v: Vec } & Record<string, unknown>> = {};
    const r = regressVelocity(tr.cells);
    if (r && r.rms < 6.0 && tr.cells.length >= 4) {
      est.push(r.v);
      w.push(1.0);
      src.track_regression = { v: r.v, rms_km: r.rms, n: tr.cells.length };
    }
    const prevs = frames.slice(0, -1).filter((f) => cur.t - f.t >= 900 && cur.t - f.t <= 3000);
    if (prevs.length && lastCell(tr).areaKm2 >= 20) {
      let pf = prevs[0];
      let bd = Math.abs(cur.t - pf.t - 1800);
      for (const f of prevs) {
        const d = Math.abs(cur.t - f.t - 1800);
        if (d < bd) {
          bd = d;
          pf = f;
        }
      }
      const lm = localMotion(pf, cur, lastCell(tr), 8, pg);
      if (lm && lm.score >= 0.5) {
        est.push([lm.vx, lm.vy]);
        w.push(1.0);
        src.local_trec = { v: [lm.vx, lm.vy], score: lm.score, dt_min: (cur.t - pf.t) / 60 };
      }
    }
    if (pg) {
      est.push(pg);
      w.push(0.5); // prototype: `0.5 if len(est) > 0 else 1.0` evaluated after the append => always 0.5
      src.global = { v: pg };
    }
    const reg = src.track_regression?.v ?? null;
    const loc = src.local_trec?.v ?? null;
    if (!est.length) {
      tr.v = [0, 0];
      tr.vSrc = {};
      tr.vSpread = 99.0;
      tr.vConf = 'none';
    } else {
      let spread = 10.0;
      if (est.length > 1) {
        spread = 0;
        for (let i = 0; i < est.length; i++)
          for (let j = i + 1; j < est.length; j++) spread = Math.max(spread, Math.hypot(est[i][0] - est[j][0], est[i][1] - est[j][1]));
      }
      const agree = reg !== null && loc !== null && Math.hypot(reg[0] - loc[0], reg[1] - loc[1]) <= 12.0;
      let v: Vec;
      let conf: 'ok' | 'low';
      if (agree && reg && loc) {
        // two cell-specific estimators agree: trust them; the whole-field motion is only a prior
        v = [(reg[0] + loc[0]) / 2.0, (reg[1] + loc[1]) / 2.0];
        conf = 'ok';
        spread = Math.hypot(reg[0] - loc[0], reg[1] - loc[1]);
      } else if (est.length >= 3) {
        v = [median(est.map((e) => e[0])), median(est.map((e) => e[1]))];
        conf = spread <= 15.0 ? 'ok' : 'low';
      } else {
        const ws = w.reduce((a, b) => a + b, 0);
        v = [est.reduce((s, e, i) => s + e[0] * w[i], 0) / ws, est.reduce((s, e, i) => s + e[1] * w[i], 0) / ws];
        conf = est.length >= 2 && spread <= 15.0 ? 'ok' : 'low';
      }
      if (spread > 25.0 && pg && !agree) {
        v = [pg[0], pg[1]]; // estimators disagree wildly -> fall back to whole-field motion
        conf = 'low';
      }
      tr.v = [v[0], v[1]];
      tr.vSrc = src;
      tr.vSpread = spread;
      tr.vConf = conf;
    }
    tr.trend = trendOf(tr.cells);
  }
}
