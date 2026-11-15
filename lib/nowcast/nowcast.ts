/** Issue one nowcast from a list of frames (only data up to the issue time is used). Port of snw/nowcast.py. */
import * as geo from './geo';
import { buildTracks, finalizeVelocities, uniqueFrames, lastCell, speedOf, headingOf, type Track, type Vec } from './tracker';
import { extrapolate, type Extrapolation } from './extrap';
import { makeVerdict, type Item, type Verdict } from './verdict';
import type { Cell } from './cells';
import type { Frame } from './frames';

export interface Nowcast {
  verdict: Verdict;
  items: Item[];
  tracks: Track[];
  issueFrameT: number;
  dataFrameT: number;
  nUnique: number;
  priorGlobal: Vec | null;
}

/** frames: chronological frames (may include repeats). The newest frame is 'current'. nowS = unix s UTC. */
export function issueNowcast(frames: Frame[], nowS: number): Nowcast {
  if (!frames.length) throw new Error('no frames');
  const uf = uniqueFrames(frames);
  const tFrame = frames[frames.length - 1].t; // staleness is judged on the newest published frame time
  const res = buildTracks(uf);
  finalizeVelocities(res);
  const curT = uf[uf.length - 1].t;
  const items: Item[] = [];
  for (const tr of res.tracks) {
    if (lastCell(tr).t !== curT) continue;
    items.push({ track: tr, cell: lastCell(tr), ex: extrapolate(tr) });
  }
  const verdict = makeVerdict(items, tFrame, nowS);
  return { verdict, items, tracks: res.tracks, issueFrameT: tFrame, dataFrameT: curT, nUnique: uf.length, priorGlobal: res.priorGlobal };
}

export interface CellSummary {
  tid: number;
  nObs: number;
  areaKm2: number;
  maxDbz: number;
  centroidKm: number;
  centroidBrg: number;
  edgeKm: number;
  /** Bearing from Bo Phut to the cell's nearest echo pixel (deg). */
  edgeBrg: number;
  speedKmh: number;
  /** Direction of travel (deg clockwise from north); null if nearly stationary. */
  heading: number | null;
  conf: string;
  trend: string;
  status: string;
  etaMin: number | null;
  etaWindow: [number, number] | null;
  prob: number;
  etaNearMin: number | null;
  probNear: number;
  closestKm: number;
}

/** pyRound-based rounding to n decimals, as in the prototype's summarize(). */
function r1(x: number): number {
  return geo.pyRound(x * 10) / 10;
}
function r2(x: number): number {
  return geo.pyRound(x * 100) / 100;
}

export function summarize(nc: Nowcast): CellSummary[] {
  const rows = nc.items.map(({ track: tr, cell: c, ex }: { track: Track; cell: Cell; ex: Extrapolation }) => ({
    tid: tr.tid,
    nObs: tr.cells.length,
    areaKm2: geo.pyRound(c.areaKm2),
    maxDbz: geo.pyRound(c.maxDbz),
    centroidKm: r1(c.distKm),
    centroidBrg: geo.pyRound(c.bearing),
    edgeKm: r1(c.edgeKm),
    edgeBrg: geo.pyRound(c.edgeBearing),
    speedKmh: r1(speedOf(tr)),
    heading: speedOf(tr) < 0.5 ? null : geo.pyRound(headingOf(tr)),
    conf: tr.vConf,
    trend: tr.trend.label,
    status: ex.status,
    etaMin: ex.etaCentralMin,
    etaWindow: ex.etaWindowMin,
    prob: r2(ex.prob),
    etaNearMin: ex.etaNearCentralMin,
    probNear: r2(ex.probNear),
    closestKm: r1(ex.closestKm),
  }));
  return rows.sort((a, b) => a.edgeKm - b.edgeKm);
}
