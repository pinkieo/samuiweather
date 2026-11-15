/** One-line, hedged, plain-English verdict (Bangkok time) from per-cell extrapolations (port of snw/verdict.py). */
import * as C from './config';
import * as geo from './geo';
import { speedOf, type Track } from './tracker';
import type { Cell } from './cells';
import type { Extrapolation } from './extrap';

export interface Item {
  track: Track;
  cell: Cell;
  ex: Extrapolation;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** HH:MM in Bangkok / Samui time (UTC+7) for a unix-seconds UTC time. */
export function fmtIct(tUtc: number): string {
  const s = Math.floor(tUtc) + C.ICT_OFFSET_S;
  const day = ((s % 86400) + 86400) % 86400;
  return `${pad2(Math.floor(day / 3600))}:${pad2(Math.floor((day % 3600) / 60))}`;
}

export function cellName(c: Cell): string {
  if (c.areaKm2 >= 500 && c.elong >= 2.5) return 'Band';
  if (c.areaKm2 < 30) return 'Isolated shower';
  if (c.maxDbz >= 45 && c.areaKm2 < 400) return 'Heavy cell';
  if (c.areaKm2 >= 400) return 'Rain area';
  return 'Showers';
}

const likely = (prob: number) => (prob >= 0.6 ? 'likely' : 'possibly');

function etaText(ex: Extrapolation, tIssue: number, prob: number): string {
  const [lo, hi] = ex.etaWindowMin ?? [ex.etaCentralMin as number, ex.etaCentralMin as number];
  const c = ex.etaCentralMin !== null ? ex.etaCentralMin : lo;
  const tc = tIssue + c * 60;
  if (hi - lo >= 40) return `${likely(prob)} between ${fmtIct(tIssue + lo * 60)} and ${fmtIct(tIssue + hi * 60)}`;
  return c >= 10 ? `${likely(prob)} around ${fmtIct(tc)}` : `${likely(prob)} within the next 10 minutes`;
}

export function describe(item: Item, tIssue: number): string {
  const { cell: c, ex, track: tr } = item;
  const nm = cellName(c);
  const d = geo.pyRound(ex.edgeKmNow > 0 ? ex.edgeKmNow : c.edgeKm);
  const br = geo.compass16(c.edgeBearing);
  const trend = tr.trend.label;
  const weak = trend === 'decaying' ? ' (weakening)' : trend === 'growing' ? ' (strengthening)' : '';
  const st = ex.status;
  if (st === 'approaching') {
    const prob = ex.prob;
    if (trend === 'decaying') {
      // shrinking cells often die before arriving: never better than 'possibly'
      return `${nm} ${d} km ${br} heading for the island but weakening, ${etaText(ex, tIssue, Math.min(prob, 0.5))}, may fade first`;
    }
    return `${nm} ${d} km ${br} heading for the island${weak}, ${etaText(ex, tIssue, prob)}`;
  }
  if (st === 'overhead') {
    if (ex.clearCentralMin !== null && ex.clearCentralMin > 0 && speedOf(tr) >= 3) {
      return `${nm} over Bo Phut now${weak}, ${likely(Math.max(ex.prob, 0.6))} clearing by ~${fmtIct(tIssue + ex.clearCentralMin * 60)}`;
    }
    return `${nm} over Bo Phut now${weak}, no clear sign of moving off within 3 h`;
  }
  if (st === 'near') {
    let when = '';
    if (ex.etaNearCentralMin !== null && ex.etaNearCentralMin > 0) {
      when = `, ${likely(Math.max(ex.probNear, 0.4))} within 10 km around ${fmtIct(tIssue + ex.etaNearCentralMin * 60)}`;
    }
    return `${nm} ${d} km ${br}${weak}, close to the island but not expected over Bo Phut${when}`;
  }
  if (st === 'receding') return `${nm} ${d} km ${br}, drifting away${weak}`;
  if (st === 'passing') {
    return `${nm} ${d} km ${br}${weak}, likely passing about ${geo.pyRound(ex.closestKm)} km from Bo Phut around ${fmtIct(tIssue + ex.closestAtMin * 60)}`;
  }
  if (ex.prob > 0 || (trend === 'growing' && d < 25)) {
    return `${nm} ${d} km ${br}${weak}, nearly stationary, small chance of drifting onto the island`;
  }
  return `${nm} ${d} km ${br}${weak}, nearly stationary, not expected to reach the island`;
}

export type Category = Extrapolation['status'] | 'none';

export interface Verdict {
  text: string;
  category: Category;
  stale: boolean;
  ageMin: number;
  /** Newest published radar frame, unix seconds UTC. */
  frameTime: number;
  frameTimeIct: string;
  headlineTid: number | null;
}

/** items: per-cell dict(track, cell, ex). `nowS` = current unix seconds UTC. */
export function makeVerdict(items: Item[], tFrame: number, nowS: number): Verdict {
  const ageMin = (nowS - tFrame) / 60.0;
  const stale = ageMin > C.STALE_MIN;
  const alert = (s: string) => s === 'approaching' || s === 'overhead' || s === 'near';
  const elig = items.filter((i) => i.cell.areaKm2 >= 15 || alert(i.ex.status));
  const near = elig.filter((i) => i.ex.edgeKmNow <= C.NEAR_KM || alert(i.ex.status));
  const appr = near
    .filter((i) => i.ex.status === 'approaching')
    .sort((a, b) => (a.ex.etaCentralMin ?? 999) - (b.ex.etaCentralMin ?? 999));
  const over = near.filter((i) => i.ex.status === 'overhead');
  const close = near.filter((i) => i.ex.status === 'near').sort((a, b) => a.ex.edgeKmNow - b.ex.edgeKmNow);
  const rest = near.filter((i) => !alert(i.ex.status)).sort((a, b) => a.ex.edgeKmNow - b.ex.edgeKmNow);
  const ordered = [...over, ...appr, ...close, ...rest];
  let text: string;
  let headline: Item | null = null;
  let cat: Category;
  if (!ordered.length) {
    const far = [...elig].sort((a, b) => a.ex.edgeKmNow - b.ex.edgeKmNow);
    text = `No rain within ${Math.trunc(C.NEAR_KM)} km`;
    if (far.length) {
      const f = far[0];
      text += ` (nearest ${geo.pyRound(f.ex.edgeKmNow)} km ${geo.compass16(f.cell.edgeBearing)})`;
    }
    cat = 'none';
  } else {
    headline = ordered[0];
    cat = headline.ex.status;
    text = describe(headline, tFrame);
    const others = ordered.length - 1;
    if (others > 0) {
      const moreAppr = appr.length - (cat === 'approaching' ? 1 : 0);
      text += ` (+${others} other cell${others > 1 ? 's' : ''}` + (moreAppr > 0 ? `, ${moreAppr} also approaching` : '') + ')';
    }
  }
  if (stale) text = `STALE (newest radar frame ${geo.pyRound(ageMin)} min old) - ` + text;
  return {
    text,
    category: cat,
    stale,
    ageMin,
    frameTime: tFrame,
    frameTimeIct: fmtIct(tFrame),
    headlineTid: headline ? headline.track.tid : null,
  };
}
