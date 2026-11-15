/** Cell detection: threshold + 8-connected components + min-area filter (port of snw/cells.py). */
import * as C from './config';
import * as geo from './geo';
import type { Frame } from './frames';

export interface Cell {
  /** Frame time (unix s, UTC). */
  t: number;
  cid: number;
  /** Centroid, tile px. */
  cx: number;
  cy: number;
  areaPx: number;
  areaKm2: number;
  maxDbz: number;
  /** Pixel coordinates, row-major order: xs[i], ys[i]. */
  xs: Int32Array;
  ys: Int32Array;
  /** Centroid relative to Bo Phut (km). */
  eastKm: number;
  northKm: number;
  distKm: number;
  /** Distance from Bo Phut to the nearest rain pixel of the cell. */
  edgeKm: number;
  bearing: number;
  /** Major/minor axis ratio of the pixel cloud. */
  elong: number;
  edgeBearing: number;
}

const W = C.TILE;

/**
 * Detect cells on one frame inside `box` (default: the wide context box).
 * Equivalent to scipy: opening with a 2x2 structure (= union of fully-set 2x2 blocks) then
 * 8-connected labelling, raster-order labels, area >= minPx.
 */
export function detect(
  frame: Frame,
  thr: number = C.CELL_DBZ,
  minPx: number = C.MIN_AREA_PX,
  box: { latS: number; latN: number; lonW: number; lonE: number } = C.CONTEXT,
): Cell[] {
  const q = frame.q;
  const { y0, y1, x0, x1 } = geo.boxPx(box);
  const mask0 = new Uint8Array(W * W);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = q[y * W + x];
      if (v !== 0 && v - 32 >= thr) mask0[y * W + x] = 1;
    }
  }
  // drop 1-px speckle: keep pixels that belong to a fully-set 2x2 block
  const mask = new Uint8Array(W * W);
  for (let y = 0; y < W - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      if (mask0[i] && mask0[i + 1] && mask0[i + W] && mask0[i + W + 1]) {
        mask[i] = 1;
        mask[i + 1] = 1;
        mask[i + W] = 1;
        mask[i + W + 1] = 1;
      }
    }
  }
  // 8-connected labelling (raster order of first pixel)
  const lab = new Int32Array(W * W);
  const cells: Cell[] = [];
  const [bx, by] = geo.bophutPx();
  let nLab = 0;
  let k = 0;
  const stack: number[] = [];
  for (let s = 0; s < W * W; s++) {
    if (!mask[s] || lab[s]) continue;
    nLab++;
    const members: number[] = [];
    lab[s] = nLab;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop() as number;
      members.push(p);
      const py = (p / W) | 0;
      const px = p - py * W;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= W) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= W || (dx === 0 && dy === 0)) continue;
          const ni = ny * W + nx;
          if (mask[ni] && !lab[ni]) {
            lab[ni] = nLab;
            stack.push(ni);
          }
        }
      }
    }
    if (members.length < minPx) continue;
    members.sort((a, b) => a - b); // row-major, like np.nonzero
    const n = members.length;
    const xs = new Int32Array(n);
    const ys = new Int32Array(n);
    let sx = 0;
    let sy = 0;
    let maxDbz = -Infinity;
    let dMin = Infinity;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const p = members[i];
      const y = (p / W) | 0;
      const x = p - y * W;
      xs[i] = x;
      ys[i] = y;
      sx += x;
      sy += y;
      const dbz = q[p] - 32;
      if (dbz > maxDbz) maxDbz = dbz;
      const dd = Math.hypot((x - bx) * geo.KMPX, (y - by) * geo.KMPX);
      if (dd < dMin) {
        dMin = dd;
        j = i;
      }
    }
    const cx = sx / n;
    const cy = sy / n;
    const [e, nn] = geo.pxToKmRel(cx, cy, [bx, by]);
    const eb = geo.bearingDeg((xs[j] - bx) * geo.KMPX, -(ys[j] - by) * geo.KMPX);
    let elong = 1.0;
    if (n >= 3) {
      // np.cov (ddof=1) + 1e-6 I, eigenvalues of the symmetric 2x2
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - cx;
        const dy = ys[i] - cy;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
      }
      const a = sxx / (n - 1) + 1e-6;
      const d = syy / (n - 1) + 1e-6;
      const b = sxy / (n - 1);
      const tr = a + d;
      const disc = Math.sqrt(Math.max(0, ((a - d) / 2) ** 2 + b * b));
      const lo = tr / 2 - disc;
      const hi = tr / 2 + disc;
      elong = Math.sqrt(hi / Math.max(lo, 1e-6));
    }
    k++;
    cells.push({
      t: frame.t,
      cid: k,
      cx,
      cy,
      areaPx: n,
      areaKm2: n * geo.KMPX ** 2,
      maxDbz,
      xs,
      ys,
      eastKm: e,
      northKm: nn,
      distKm: Math.hypot(e, nn),
      edgeKm: dMin,
      bearing: geo.bearingDeg(e, nn),
      elong,
      edgeBearing: eb,
    });
  }
  return cells;
}
