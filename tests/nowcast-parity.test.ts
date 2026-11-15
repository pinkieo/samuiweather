/**
 * Parity test: the TypeScript port vs the offline Python prototype on the SAME archived RainViewer frames.
 *
 * Fixtures (tests/fixtures/nowcast/, regenerate with gen_parity_fixture.py from the prototype's archive):
 *   parity-frames.json    archived frames (gzip+base64 uint8 q) + palette decode cases
 *   parity-expected.json  prototype output at every archived frame (3 h window, now = frame + 4 min)
 * Compared per issue time: distinct-scan count, whole-field prior, verdict text/category/stale/headline,
 * and per cell: tracks, size, intensity, motion vector, speed/heading, status, ETA/window/probability, per-cell text.
 * Run: npx tsx --test tests/nowcast-parity.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { issueNowcast } from '../lib/nowcast/nowcast';
import { decodeRgba, type Frame } from '../lib/nowcast/frames';
import { headingOf, speedOf } from '../lib/nowcast/tracker';
import { describe } from '../lib/nowcast/verdict';

const DIR = path.join(__dirname, 'fixtures', 'nowcast');
const framesJson = JSON.parse(readFileSync(path.join(DIR, 'parity-frames.json'), 'utf8')) as {
  frames: Array<{ t: number; q: string }>;
  decode: { rgba: string; q: string; n: number };
};
const expected = JSON.parse(readFileSync(path.join(DIR, 'parity-expected.json'), 'utf8')) as {
  generated_from: { n_frames: number; hours: number; now_lag: number };
  issues: Array<{
    index: number;
    now: number;
    n_unique: number;
    t_frame: number;
    data_t: number;
    prior_global: [number, number] | null;
    verdict: { text: string; category: string; stale: boolean; age_min: number; frame_time_ict: string; headline_tid: number | null };
    cells: Array<{
      tid: number; n_obs: number; cx: number; cy: number; area_px: number; area_km2: number; max_dbz: number; elong: number;
      edge_km: number; edge_bearing: number; vx: number; vy: number; speed: number; heading: number | null; v_conf: string;
      v_spread: number; trend: string; dlnA: number | null; ddbz: number | null; status: string; edge_km_now: number; eta: number | null; window: [number, number] | null;
      prob: number; clear: number | null; eta_near: number | null; prob_near: number; closest_km: number; closest_at: number | null; closest_at_edge: boolean; text: string;
    }>;
  }>;
};

const frames: Frame[] = framesJson.frames.map((f) => ({ t: f.t, q: new Uint8Array(gunzipSync(Buffer.from(f.q, 'base64'))) }));

// Tolerances (documented in the PR). Everything discrete must match exactly.
const TOL = { geom: 1e-6, velKmh: 0.05, spread: 0.05, km: 0.05, angleDeg: 0.5 };

test('palette decode: random + palette + near-palette RGBA matches the prototype exactly', () => {
  const rgba = new Uint8Array(Buffer.from(framesJson.decode.rgba, 'base64'));
  const want = new Uint8Array(Buffer.from(framesJson.decode.q, 'base64'));
  const got = decodeRgba(rgba, framesJson.decode.n, 1);
  let bad = 0;
  for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) bad++;
  assert.equal(bad, 0, `${bad}/${want.length} pixels differ`);
});

test('TS port == Python prototype on archived frames (all issue times)', () => {
  const stats = { issues: 0, cells: 0, maxVel: 0, maxSpread: 0, maxKm: 0, maxAngle: 0, maxGeom: 0, approaching: 0, overhead: 0, edgeCells: 0, interiorPassing: 0, verdictsEqual: 0 };
  const problems: string[] = [];
  const hoursS = expected.generated_from.hours * 3600;
  for (const ex of expected.issues) {
    const upto = frames.slice(0, ex.index + 1);
    const tmax = upto[upto.length - 1].t;
    const sub = upto.filter((f) => f.t >= tmax - hoursS);
    const nc = issueNowcast(sub, ex.now);
    const tag = `issue@${tmax}`;
    stats.issues++;
    const bad = (m: string) => problems.push(`${tag}: ${m}`);
    if (nc.nUnique !== ex.n_unique) bad(`n_unique ${nc.nUnique} != ${ex.n_unique}`);
    if (nc.issueFrameT !== ex.t_frame || nc.dataFrameT !== ex.data_t) bad('frame times differ');
    if ((nc.priorGlobal === null) !== (ex.prior_global === null)) bad('prior_global presence differs');
    else if (nc.priorGlobal && ex.prior_global) {
      const d = Math.hypot(nc.priorGlobal[0] - ex.prior_global[0], nc.priorGlobal[1] - ex.prior_global[1]);
      stats.maxVel = Math.max(stats.maxVel, d);
      if (d > TOL.velKmh) bad(`prior_global differs by ${d.toFixed(4)} km/h`);
    }
    const v = nc.verdict;
    if (v.text === ex.verdict.text) stats.verdictsEqual++;
    else bad(`verdict text\n   ts: ${v.text}\n   py: ${ex.verdict.text}`);
    if (v.category !== ex.verdict.category) bad(`category ${v.category} != ${ex.verdict.category}`);
    if (v.stale !== ex.verdict.stale) bad('stale flag differs');
    if (v.frameTimeIct !== ex.verdict.frame_time_ict) bad('frame time (ICT) differs');
    if (v.headlineTid !== ex.verdict.headline_tid) bad(`headline tid ${v.headlineTid} != ${ex.verdict.headline_tid}`);
    if (Math.abs(v.ageMin - ex.verdict.age_min) > 1e-6) bad('age differs');

    if (nc.items.length !== ex.cells.length) {
      bad(`cell count ${nc.items.length} != ${ex.cells.length}`);
      continue;
    }
    for (const pc of ex.cells) {
      const it = nc.items.find((i) => Math.abs(i.cell.cx - pc.cx) < 1e-6 && Math.abs(i.cell.cy - pc.cy) < 1e-6 && i.cell.areaPx === pc.area_px);
      if (!it) {
        bad(`no TS cell for python cell tid=${pc.tid} at (${pc.cx.toFixed(2)},${pc.cy.toFixed(2)})`);
        continue;
      }
      stats.cells++;
      if (pc.status === 'approaching') stats.approaching++;
      if (pc.status === 'overhead') stats.overhead++;
      if (pc.status === 'passing' && pc.closest_at_edge) stats.edgeCells++;
      if (pc.status === 'passing' && !pc.closest_at_edge) stats.interiorPassing++;
      const c = `cell tid=${pc.tid}`;
      const { cell, track: tr, ex: e } = it;
      if (tr.tid !== pc.tid) bad(`${c}: tid ${tr.tid}`);
      if (tr.cells.length !== pc.n_obs) bad(`${c}: n_obs ${tr.cells.length} != ${pc.n_obs}`);
      const geom = Math.max(Math.abs(cell.areaKm2 - pc.area_km2), Math.abs(cell.maxDbz - pc.max_dbz), Math.abs(cell.edgeKm - pc.edge_km), Math.abs(cell.elong - pc.elong), Math.abs(cell.edgeBearing - pc.edge_bearing));
      stats.maxGeom = Math.max(stats.maxGeom, geom);
      if (geom > TOL.geom * 100) bad(`${c}: geometry differs by ${geom}`);
      const dv = Math.hypot(tr.v[0] - pc.vx, tr.v[1] - pc.vy);
      stats.maxVel = Math.max(stats.maxVel, dv);
      if (dv > TOL.velKmh) bad(`${c}: velocity differs by ${dv.toFixed(4)} km/h (ts ${tr.v.map((x) => x.toFixed(2))} py ${pc.vx.toFixed(2)},${pc.vy.toFixed(2)})`);
      const ds = Math.abs(tr.vSpread - pc.v_spread);
      stats.maxSpread = Math.max(stats.maxSpread, ds);
      if (ds > TOL.spread) bad(`${c}: spread differs by ${ds}`);
      if (tr.vConf !== pc.v_conf) bad(`${c}: conf ${tr.vConf} != ${pc.v_conf}`);
      if (pc.heading !== null && speedOf(tr) > 0.5) {
        const dh = Math.abs(((headingOf(tr) - pc.heading + 540) % 360) - 180);
        stats.maxAngle = Math.max(stats.maxAngle, dh);
        if (dh > TOL.angleDeg) bad(`${c}: heading differs by ${dh.toFixed(2)}°`);
      } else if ((pc.heading === null) !== !(speedOf(tr) > 0.5)) bad(`${c}: heading presence differs`);
      // slopes are rounded to 1e-9 in both implementations, so threshold ties no longer depend on float noise
      if (tr.trend.label !== pc.trend) bad(`${c}: trend ${tr.trend.label} != ${pc.trend}`);
      if (tr.trend.dlnAPerH !== null && pc.dlnA !== null && (Math.abs(tr.trend.dlnAPerH - pc.dlnA) > 1e-6 || Math.abs((tr.trend.ddbzPerH ?? 0) - (pc.ddbz ?? 0)) > 1e-6)) bad(`${c}: trend slopes differ`);
      if (e.status !== pc.status) bad(`${c}: status ${e.status} != ${pc.status}`);
      const dk = Math.max(Math.abs(e.edgeKmNow - pc.edge_km_now), Math.abs(e.closestKm - pc.closest_km));
      stats.maxKm = Math.max(stats.maxKm, dk);
      if (dk > TOL.km) bad(`${c}: distance differs by ${dk}`);
      if (e.etaCentralMin !== pc.eta) bad(`${c}: eta ${e.etaCentralMin} != ${pc.eta}`);
      if (JSON.stringify(e.etaWindowMin) !== JSON.stringify(pc.window)) bad(`${c}: window ${JSON.stringify(e.etaWindowMin)} != ${JSON.stringify(pc.window)}`);
      if (Math.abs(e.prob - pc.prob) > 1e-9 || Math.abs(e.probNear - pc.prob_near) > 1e-9) bad(`${c}: probability differs`);
      if (e.clearCentralMin !== pc.clear || e.etaNearCentralMin !== pc.eta_near || e.closestAtMin !== pc.closest_at || e.closestAtEdge !== pc.closest_at_edge) bad(`${c}: clear/near/closest_at differs`);
      const text = describe(it, nc.issueFrameT);
      if (text !== pc.text) bad(`${c}: text\n   ts: ${text}\n   py: ${pc.text}`);
    }
  }
  console.log('PARITY SUMMARY', JSON.stringify({ ...stats, tolerances: TOL, problems: problems.length }));
  assert.ok(stats.cells > 100, `parity set too small (${stats.cells} cells)`);
  assert.ok(stats.approaching > 0 && stats.overhead > 0, 'parity set should include approaching and overhead cells');
  assert.ok(stats.edgeCells > 0 && stats.interiorPassing > 0, 'parity set should include passing cells at the horizon edge and interior ones');
  assert.equal(problems.length, 0, `\n${problems.slice(0, 25).join('\n')}${problems.length > 25 ? `\n… +${problems.length - 25} more` : ''}`);
});
