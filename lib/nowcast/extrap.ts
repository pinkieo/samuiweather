/** Per-cell extrapolation 0-3 h with a small motion ensemble (port of snw/extrap.py). */
import * as C from './config';
import * as geo from './geo';
import { speedOf, lastCell, type Track, type Vec } from './tracker';

export const LEADS: number[] = [];
for (let m = 0; m <= C.HORIZON_MIN; m += C.LEAD_STEP_MIN) LEADS.push(m);

function members(v: Vec, spread: number): { out: Vec[]; sig: number } {
  const sp = Math.hypot(v[0], v[1]);
  const sig = Math.max(3.0, 0.3 * sp, 0.5 * spread); // km/h
  let ua: Vec;
  let uc: Vec;
  if (sp > 1.0) {
    ua = [v[0] / sp, v[1] / sp];
    uc = [-ua[1], ua[0]];
  } else {
    ua = [1.0, 0.0];
    uc = [0.0, 1.0];
  }
  const out: Vec[] = [];
  for (const a of [-1, 0, 1]) for (const c of [-1, 0, 1]) out.push([v[0] + a * sig * ua[0] + c * sig * uc[0], v[1] + a * sig * ua[1] + c * sig * uc[1]]);
  return { out, sig };
}

/** Distance (km) from Bo Phut to the nearest rain pixel of the cell, translated by v for each lead. */
export function mindistCurve(xs: Int32Array, ys: Int32Array, v: Vec): number[] {
  const [bx, by] = geo.bophutPx();
  const n = xs.length;
  const ex = new Float64Array(n);
  const ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ex[i] = (xs[i] - bx) * geo.KMPX;
    ny[i] = -(ys[i] - by) * geo.KMPX;
  }
  return LEADS.map((lead) => {
    const sx = (v[0] * lead) / 60.0;
    const sy = (v[1] * lead) / 60.0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (ex[i] + sx) ** 2 + (ny[i] + sy) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  });
}

export interface EtaInfo {
  etaCentral: number | null;
  window: [number, number] | null;
  prob: number;
  clearCentral: number | null;
}

function eta(curves: number[][], thr: number): EtaInfo {
  const reach = curves.map((c) => c.map((d) => d <= thr));
  const hits: number[] = [];
  for (const r of reach) {
    const idx = r.indexOf(true);
    if (idx >= 0) hits.push(LEADS[idx]);
  }
  const central = reach[4];
  const c0 = central.indexOf(true);
  const etaC = c0 >= 0 ? LEADS[c0] : null;
  let clear: number | null = null;
  if (c0 >= 0) {
    for (let i = c0; i < central.length; i++) {
      if (!central[i]) {
        clear = LEADS[i];
        break;
      }
    }
  }
  return {
    etaCentral: etaC,
    window: hits.length ? [Math.min(...hits), Math.max(...hits)] : null,
    prob: hits.length / curves.length,
    clearCentral: clear,
  };
}

export type Status = 'overhead' | 'approaching' | 'near' | 'stationary' | 'receding' | 'passing';

export interface Extrapolation {
  status: Status;
  edgeKmNow: number;
  point: EtaInfo;
  near: EtaInfo;
  etaCentralMin: number | null;
  etaWindowMin: [number, number] | null;
  prob: number;
  clearCentralMin: number | null;
  probNear: number;
  etaNearCentralMin: number | null;
  etaNearWindowMin: [number, number] | null;
  clearNearMin: number | null;
  closestKm: number;
  /** Lead (min) of the central member's closest approach; null when it falls on the last lead (3 h horizon edge). */
  closestAtMin: number | null;
  /** True when the central track is still closing in at the end of the horizon (closest approach not observable). */
  closestAtEdge: boolean;
  distAtEnd: number;
  sigmaKmh: number;
  nMembers: number;
  /** Central-member distance (km) from Bo Phut to the cell's nearest echo for each lead (0..180 min, 5 min step). */
  curve: number[];
}

/** Ensemble extrapolation of the cell's pixels. Two radii: POINT_KM (rain at Bo Phut) and REACH_KM (within ~10 km). */
export function extrapolate(tr: Track): Extrapolation {
  const cell = lastCell(tr);
  const { out: mem, sig } = members(tr.v, tr.vSpread < 90 ? tr.vSpread : 10.0);
  const curves = mem.map((m) => mindistCurve(cell.xs, cell.ys, m));
  const central = curves[4];
  const pt = eta(curves, C.POINT_KM);
  const nr = eta(curves, C.REACH_KM);
  let k = 0;
  for (let i = 1; i < central.length; i++) if (central[i] < central[k]) k = i;
  const sp = speedOf(tr);
  const d0 = central[0];
  const dend = central[central.length - 1];
  // If the minimum sits on the last lead (end of the 3 h horizon) the cell is still closing in and the true
  // closest-approach time is beyond what we can see: report null instead of a fake time.
  const atEdge = k === LEADS.length - 1;
  let status: Status;
  if (d0 <= C.POINT_KM) status = 'overhead';
  else if (pt.prob >= 0.25 || pt.etaCentral !== null) status = 'approaching';
  else if (d0 <= C.REACH_KM || nr.prob >= 0.25 || nr.etaCentral !== null) status = 'near';
  else if (sp < 3.0 || Math.abs(dend - d0) < 3.0) status = 'stationary';
  else if (dend > d0 + 3.0 && k === 0) status = 'receding';
  else status = 'passing';
  return {
    status,
    edgeKmNow: d0,
    point: pt,
    near: nr,
    etaCentralMin: pt.etaCentral,
    etaWindowMin: pt.window,
    prob: pt.prob,
    clearCentralMin: pt.clearCentral,
    probNear: nr.prob,
    etaNearCentralMin: nr.etaCentral,
    etaNearWindowMin: nr.window,
    clearNearMin: nr.clearCentral,
    closestKm: central[k],
    closestAtMin: atEdge ? null : LEADS[k],
    closestAtEdge: atEdge,
    distAtEnd: dend,
    sigmaKmh: sig,
    nMembers: mem.length,
    curve: central,
  };
}
