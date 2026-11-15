/**
 * Experimental nowcast service: live frames -> issueNowcast -> API payload.
 * Always returns an explicit state: status "ok" or status "unavailable" (never made-up data).
 */
import * as C from './config';
import { issueNowcast, summarize, type CellSummary, type Nowcast } from './nowcast';
import { describe, fmtIct, makeVerdict, type Verdict } from './verdict';
import { loadFrames, UpstreamError, type LoadedFrames } from './rainviewer';
import type { Frame } from './frames';

export const MIN_UNIQUE_FRAMES = 3;

export interface NowcastCell extends CellSummary {
  /** Hedged one-line description of this cell. */
  text: string;
  /** Bangkok-time (HH:MM) central ETA of rain at Bo Phut, if any. */
  etaIct: string | null;
  /** Bangkok-time window for rain at Bo Phut, if any. */
  etaWindowIct: [string, string] | null;
}

export interface NowcastOk {
  status: 'ok';
  experimental: true;
  generatedAt: string;
  generatedAtIct: string;
  target: { name: string; lat: number; lon: number };
  verdict: Verdict;
  frame: {
    newestUnix: number;
    newestIso: string;
    newestIct: string;
    ageMin: number;
    stale: boolean;
    /** Frames listed by RainViewer / frames successfully decoded / distinct scans after de-duplication. */
    published: number;
    decoded: number;
    unique: number;
    failed: number;
  };
  cells: NowcastCell[];
  method: string;
  source: string;
  disclaimer: string;
}

export interface NowcastUnavailable {
  status: 'unavailable';
  experimental: true;
  generatedAt: string;
  reason: string;
  detail: string;
}

export type NowcastResponse = NowcastOk | NowcastUnavailable;

const METHOD =
  'Per-cell tracking of RainViewer radar echoes (>=20 dBZ, >=5 px) over ~3 h of frames; each cell is extrapolated ' +
  '0-3 h with a 9-member speed/heading ensemble. Times are Bangkok time (UTC+7).';
const SOURCE = 'RainViewer public radar tiles (z7, colour scheme Universal Blue)';
const DISCLAIMER =
  'EXPERIMENTAL. Unverified radar extrapolation: cells can grow, split or fade. Not a forecast; scoring is still in progress.';

const iso = (s: number) => new Date(s * 1000).toISOString();

export function unavailable(nowS: number, reason: string, detail: string): NowcastUnavailable {
  return { status: 'unavailable', experimental: true, generatedAt: iso(nowS), reason, detail };
}

/** Build the API payload from an issued nowcast (pure; used by the route and tests). */
export function buildResponse(nc: Nowcast, nowS: number, meta: { published: number; decoded: number; failed: number }): NowcastOk {
  // Re-evaluate staleness at response time (the nowcast itself may be cached for a short while).
  const verdict = makeVerdict(nc.items, nc.issueFrameT, nowS);
  const byTid = new Map(nc.items.map((i) => [i.track.tid, i]));
  const cells: NowcastCell[] = summarize(nc).map((row) => {
    const item = byTid.get(row.tid)!;
    const win = row.etaWindow;
    return {
      ...row,
      text: describe(item, nc.issueFrameT),
      etaIct: row.etaMin !== null ? fmtIct(nc.issueFrameT + row.etaMin * 60) : null,
      etaWindowIct: win ? [fmtIct(nc.issueFrameT + win[0] * 60), fmtIct(nc.issueFrameT + win[1] * 60)] : null,
    };
  });
  return {
    status: 'ok',
    experimental: true,
    generatedAt: iso(nowS),
    generatedAtIct: fmtIct(nowS),
    target: { name: 'Bo Phut', lat: C.BOPHUT.lat, lon: C.BOPHUT.lon },
    verdict,
    frame: {
      newestUnix: nc.issueFrameT,
      newestIso: iso(nc.issueFrameT),
      newestIct: fmtIct(nc.issueFrameT),
      ageMin: verdict.ageMin,
      stale: verdict.stale,
      published: meta.published,
      decoded: meta.decoded,
      unique: nc.nUnique,
      failed: meta.failed,
    },
    cells,
    method: METHOD,
    source: SOURCE,
    disclaimer: DISCLAIMER,
  };
}

export function nowcastFromFrames(frames: Frame[], nowS: number, meta?: { published?: number; failed?: number }): NowcastResponse {
  if (!frames.length) return unavailable(nowS, 'no_frames', 'No radar frames available.');
  const nc = issueNowcast(frames, nowS);
  if (nc.nUnique < MIN_UNIQUE_FRAMES) {
    return unavailable(nowS, 'insufficient_frames', `Only ${nc.nUnique} distinct radar scans available (need ${MIN_UNIQUE_FRAMES}).`);
  }
  return buildResponse(nc, nowS, { published: meta?.published ?? frames.length, decoded: frames.length, failed: meta?.failed ?? 0 });
}

// Short in-process cache so bursts of page loads do not refetch/recompute (frames only change every ~10 min).
let cache: { at: number; loaded: LoadedFrames; nc: Nowcast } | null = null;
const CACHE_TTL_MS = 60_000;

/** Test hook: drop the in-process result cache. */
export function resetNowcastCache(): void {
  cache = null;
}

export async function getNowcast(nowMs: number = Date.now()): Promise<NowcastResponse> {
  const nowS = nowMs / 1000;
  try {
    if (!cache || nowMs - cache.at > CACHE_TTL_MS) {
      const loaded = await loadFrames();
      if (!loaded.frames.length) return unavailable(nowS, 'no_frames', 'RainViewer listed frames but none could be decoded.');
      const nc = issueNowcast(loaded.frames, nowS);
      if (nc.nUnique < MIN_UNIQUE_FRAMES) {
        return unavailable(nowS, 'insufficient_frames', `Only ${nc.nUnique} distinct radar scans available (need ${MIN_UNIQUE_FRAMES}).`);
      }
      cache = { at: nowMs, loaded, nc };
    }
    const { loaded, nc } = cache;
    return buildResponse(nc, nowS, { published: loaded.catalog.past.length, decoded: loaded.frames.length, failed: loaded.failed.length });
  } catch (e) {
    if (e instanceof UpstreamError) return unavailable(nowS, e.code, e.message);
    return unavailable(nowS, 'internal_error', 'Nowcast computation failed.');
  }
}
