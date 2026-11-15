/**
 * Synthetic sanity tests for the experimental rain nowcast (TypeScript port).
 * Port of samui-nowcast/tests/test_synthetic.py (known motion in -> speed/heading/ETA/verdict out) plus
 * unit tests for the helpers the port had to re-implement (assignment, rounding, time format, PNG decode, service states).
 * Run: npx tsx --test tests/nowcast-synthetic.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import * as geo from '../lib/nowcast/geo';
import * as C from '../lib/nowcast/config';
import { issueNowcast, type Nowcast } from '../lib/nowcast/nowcast';
import { headingOf, linearSumAssignment, speedOf, trendOf } from '../lib/nowcast/tracker';
import { describe } from '../lib/nowcast/verdict';
import type { Cell } from '../lib/nowcast/cells';
import { fmtIct } from '../lib/nowcast/verdict';
import { LEADS } from '../lib/nowcast/extrap';
import { UNIVERSAL_BLUE } from '../lib/nowcast/palette';
import { pngToQ } from '../lib/nowcast/rainviewer';
import { nowcastFromFrames, unavailable } from '../lib/nowcast/service';
import type { Frame } from '../lib/nowcast/frames';

const T0 = 1_794_700_000;
const SZ = 256;

type Blob = [east: number, north: number, radius: number, peak: number];

function blobFrame(t: number, blobs: Blob[]): Frame {
  const [bx, by] = geo.bophutPx();
  const dbz = new Float64Array(SZ * SZ).fill(-99);
  for (const [e, n, r, pk] of blobs) {
    const cx = bx + e / geo.KMPX;
    const cy = by - n / geo.KMPX;
    for (let y = 0; y < SZ; y++) {
      for (let x = 0; x < SZ; x++) {
        const d = Math.hypot(x - cx, y - cy) * geo.KMPX;
        const v = pk - 25.0 * (d / r) ** 2;
        const val = v >= 5 ? v : -99;
        if (val > dbz[y * SZ + x]) dbz[y * SZ + x] = val;
      }
    }
  }
  const q = new Uint8Array(SZ * SZ);
  for (let i = 0; i < q.length; i++) q[i] = dbz[i] > -90 ? Math.trunc(Math.min(255, Math.max(1, dbz[i] + 32))) : 0;
  return { t, q };
}

/** tracks: (e0, n0, ve, vn, radius, peak). Frames every `step` min, n frames. */
function run(tracks: Array<[number, number, number, number, number, number]>, n = 7, step = 10, nowLag = 240): { nc: Nowcast; frames: Frame[] } {
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const h = (i * step) / 60.0;
    frames.push(blobFrame(T0 + i * step * 60, tracks.map(([e0, n0, ve, vn, r, pk]) => [e0 + ve * h, n0 + vn * h, r, pk] as Blob)));
  }
  return { nc: issueNowcast(frames, frames[frames.length - 1].t + nowLag), frames };
}

test('approaching from the west: speed, heading, status, ETA, verdict', () => {
  const { nc } = run([[-40, 0, 30, 0, 7, 45]]);
  const it = nc.items[0];
  assert.ok(Math.abs(speedOf(it.track) - 30) <= 6, `speed ${speedOf(it.track)}`);
  assert.ok(Math.abs(headingOf(it.track) - 90) <= 12, `heading ${headingOf(it.track)}`);
  assert.equal(it.ex.status, 'approaching');
  const eta = it.ex.etaCentralMin;
  assert.ok(eta !== null && eta >= 0 && eta <= 25, `eta ${eta}`);
  assert.ok(nc.verdict.text.includes('heading for the island'), nc.verdict.text);
  assert.equal(nc.verdict.stale, false);
  assert.ok(/likely|possibly/.test(nc.verdict.text), 'verdict is hedged');
});

test('receding to the ESE', () => {
  const { nc } = run([[35, -15, 15, -6, 7, 45]]);
  assert.equal(nc.items[0].ex.status, 'receding');
  assert.ok(nc.verdict.text.includes('drifting away'), nc.verdict.text);
});

test('two cells moving apart: per-cell, no centroid false alarm', () => {
  const { nc } = run([
    [-30, 0, -25, 0, 7, 45],
    [30, 0, 25, 0, 7, 45],
  ]);
  assert.deepEqual(new Set(nc.items.map((i) => i.ex.status)), new Set(['receding']));
  assert.equal(nc.items.length, 2);
});

test('empty sky and far-away cell => "No rain within 70 km"', () => {
  let r = run([]);
  assert.ok(r.nc.verdict.text.startsWith('No rain within 70 km'), r.nc.verdict.text);
  assert.equal(r.nc.verdict.category, 'none');
  r = run([[-95, 40, 0, 0, 7, 45]]);
  assert.ok(r.nc.verdict.text.startsWith('No rain within 70 km'), r.nc.verdict.text);
});

test('STALE prefix when the newest frame is more than 20 min old', () => {
  const { nc } = run([[-40, 0, 30, 0, 7, 45]], 7, 10, 30 * 60);
  assert.equal(nc.verdict.stale, true);
  assert.ok(nc.verdict.text.startsWith('STALE (newest radar frame 30 min old) - '), nc.verdict.text);
  const fresh = run([[-40, 0, 30, 0, 7, 45]], 7, 10, 19 * 60).nc;
  assert.equal(fresh.verdict.stale, false);
  assert.ok(!fresh.verdict.text.startsWith('STALE'));
  const edge = run([[-40, 0, 30, 0, 7, 45]], 7, 10, 21 * 60).nc;
  assert.equal(edge.verdict.stale, true);
});

test('overhead with clearing time', () => {
  const { nc } = run([[-6, 0, 20, 0, 9, 45]], 5);
  assert.equal(nc.items[0].ex.status, 'overhead');
  assert.ok(nc.verdict.text.includes('over Bo Phut now'), nc.verdict.text);
});

test('verdict times are Bangkok time (UTC+7), HH:MM', () => {
  // 2026-11-15T05:00:00Z == 12:00 in Bangkok
  assert.equal(fmtIct(Date.UTC(2026, 10, 15, 5, 0, 0) / 1000), '12:00');
  assert.equal(fmtIct(Date.UTC(2026, 10, 15, 18, 5, 59) / 1000), '01:05');
});

test('python-style rounding (half to even) and compass', () => {
  assert.equal(geo.pyRound(0.5), 0);
  assert.equal(geo.pyRound(1.5), 2);
  assert.equal(geo.pyRound(2.5), 2);
  assert.equal(geo.pyRound(2.4999), 2);
  assert.equal(geo.pyRound(-0.5), 0);
  assert.equal(geo.compass16(0), 'N');
  assert.equal(geo.compass16(90), 'E');
  assert.equal(geo.compass16(350), 'N');
  assert.equal(geo.compass16(-90), 'W');
  assert.equal(geo.compass16(247), 'WSW');
});

test('linearSumAssignment: optimal on square, wide and tall matrices', () => {
  const pairs = (c: number[][]) => linearSumAssignment(c).map(([a, b]) => `${a}-${b}`).join(',');
  assert.equal(pairs([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), '0-1,1-0,2-2'); // total 5
  assert.equal(pairs([[1e6, 2, 1e6], [1, 1e6, 1e6]]), '0-1,1-0');
  assert.equal(pairs([[1], [0.5], [3]]), '1-0');
  assert.deepEqual(linearSumAssignment([]), []);
  // brute-force check on random small matrices
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < 50; k++) {
    const n = 1 + Math.floor(rnd() * 4);
    const m = 1 + Math.floor(rnd() * 4);
    const c = Array.from({ length: n }, () => Array.from({ length: m }, () => Math.floor(rnd() * 20)));
    const got = linearSumAssignment(c).reduce((s, [a, b]) => s + c[a][b], 0);
    const k2 = Math.min(n, m);
    let best = Infinity;
    const rec = (row: number, used: number, cnt: number, sum: number) => {
      if (cnt === k2) return void (best = Math.min(best, sum));
      if (row >= n) return;
      rec(row + 1, used, cnt, sum); // skip row
      for (let j = 0; j < m; j++) if (!(used & (1 << j))) rec(row + 1, used | (1 << j), cnt + 1, sum + c[row][j]);
    };
    rec(0, 0, 0, 0);
    assert.equal(got, best);
  }
});

test('PNG tile decode: palette colours -> dBZ+32, transparent -> 0, off-palette -> nearest', () => {
  const png = new PNG({ width: C.TILE, height: C.TILE });
  png.data.fill(0);
  const entries = [UNIVERSAL_BLUE[0], UNIVERSAL_BLUE[40], UNIVERSAL_BLUE[UNIVERSAL_BLUE.length - 1]];
  entries.forEach(([, r, g, b, a], i) => png.data.set([r, g, b, a], i * 4));
  // off-palette colour one step away from entry #1 (nearest-palette fallback)
  png.data.set([entries[1][1] + 1, entries[1][2], entries[1][3], entries[1][4]], 3 * 4);
  const q = pngToQ(PNG.sync.write(png));
  assert.equal(q.length, C.TILE * C.TILE);
  assert.equal(q[0], entries[0][0] + 32);
  assert.equal(q[1], entries[1][0] + 32);
  assert.equal(q[2], entries[2][0] + 32);
  assert.equal(q[3], entries[1][0] + 32);
  assert.equal(q[4], 0);
  assert.throws(() => pngToQ(PNG.sync.write(new PNG({ width: 8, height: 8 }))), /unexpected tile size/);
});

test('service: unavailable states are explicit, never invented', () => {
  const u = unavailable(T0, 'catalog_failed', 'x');
  assert.equal(u.status, 'unavailable');
  assert.equal(u.experimental, true);
  assert.equal(nowcastFromFrames([], T0).status, 'unavailable');
  // 2 scans only -> insufficient
  const fr = [blobFrame(T0, [[-40, 0, 7, 45]]), blobFrame(T0 + 600, [[-35, 0, 7, 45]])];
  const r = nowcastFromFrames(fr, T0 + 700);
  assert.equal(r.status, 'unavailable');
  if (r.status === 'unavailable') assert.equal(r.reason, 'insufficient_frames');
});

test('service: ok payload carries experimental flag, per-cell hedged text and Bangkok times', () => {
  const frames: Frame[] = [];
  for (let i = 0; i < 7; i++) frames.push(blobFrame(T0 + i * 600, [[-40 + 5 * i, 0, 7, 45]]));
  const r = nowcastFromFrames(frames, frames[6].t + 240);
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.equal(r.experimental, true);
  assert.equal(r.frame.stale, false);
  assert.equal(r.cells.length, 1);
  assert.match(r.cells[0].text, /heading for the island/);
  assert.match(r.cells[0].etaIct ?? '', /^\d\d:\d\d$/);
  assert.equal(r.frame.newestIct, fmtIct(frames[6].t));
  const stale = nowcastFromFrames(frames, frames[6].t + 25 * 60);
  assert.equal(stale.status, 'ok');
  if (stale.status === 'ok') {
    assert.equal(stale.verdict.stale, true);
    assert.ok(stale.verdict.text.startsWith('STALE'));
  }
});

// ---- regression: closest-approach time of "passing" cells (live bug: many cells showed 15:50 = end of the 3 h horizon) ----

test('passing cell still closing in at the 3 h horizon edge: no fake closest-approach time', () => {
  // starts 80 km W / 30 km N, 20 km/h east: still 20 km W / 30 km N at +3 h => closest approach not reached
  const { nc } = run([[-80, 30, 20, 0, 7, 45]]);
  const ex = nc.items[0].ex;
  assert.equal(ex.status, 'passing');
  assert.equal(ex.closestAtEdge, true);
  assert.equal(ex.closestAtMin, null);
  assert.match(nc.verdict.text, /still approaching at 3 h \(about \d+ km from Bo Phut by then\)/);
  assert.ok(!nc.verdict.text.includes('likely passing'), nc.verdict.text);
  assert.ok(!/\d\d:\d\d/.test(nc.verdict.text), `no clock time expected: ${nc.verdict.text}`);
});

test('passing cell with an interior closest approach: time is the central-member minimum, not the horizon end', () => {
  const { nc } = run([[-80, 30, 30, 0, 7, 45]]);
  const ex = nc.items[0].ex;
  assert.equal(ex.status, 'passing');
  assert.equal(ex.closestAtEdge, false);
  let k = 0;
  ex.curve.forEach((d, i) => {
    if (d < ex.curve[k]) k = i;
  });
  assert.equal(ex.closestAtMin, LEADS[k]);
  assert.ok(ex.closestAtMin !== null && ex.closestAtMin >= 80 && ex.closestAtMin <= 120, `closestAtMin ${ex.closestAtMin}`);
  assert.ok(ex.closestAtMin < LEADS[LEADS.length - 1]);
  assert.ok(nc.verdict.text.includes(`likely passing about 23 km from Bo Phut around ${fmtIct(nc.issueFrameT + ex.closestAtMin * 60)}`), nc.verdict.text);
});

test('passing text never contradicts a minority of ensemble members that reach Bo Phut', () => {
  const cell = { areaKm2: 100, elong: 1, maxDbz: 40, edgeBearing: 270, edgeKm: 20 } as unknown as Cell;
  const track = { tid: 1, trend: { label: 'steady' }, v: [20, 0] } as never;
  const base = { status: 'passing', edgeKmNow: 20, closestKm: 12.4, closestAtMin: 100, closestAtEdge: false, etaWindowMin: [95, 95] };
  let t = describe({ cell, track, ex: base as never }, T0);
  assert.ok(t.includes('likely passing about 12 km from Bo Phut around'), t);
  assert.ok(t.endsWith(`small chance of rain at Bo Phut around ${fmtIct(T0 + 95 * 60)}`), t);
  t = describe({ cell, track, ex: { ...base, etaWindowMin: [95, 140] } as never }, T0);
  assert.ok(t.endsWith(`small chance of rain at Bo Phut between ${fmtIct(T0 + 95 * 60)} and ${fmtIct(T0 + 140 * 60)}`), t);
  t = describe({ cell, track, ex: { ...base, closestAtMin: null, closestAtEdge: true, etaWindowMin: null } as never }, T0);
  assert.ok(t.includes('still approaching at 3 h (about 12 km'), t);
  assert.ok(!t.includes('small chance'), t);
});

test('trend slopes are rounded: a slope exactly on the 3 dBZ/h threshold is "steady" whatever the float noise', () => {
  const mk = (noise: number): Cell[] =>
    [45, 44.5, 44, 43.5].map((d, i) => ({ t: T0 + i * 600, areaKm2: 50, maxDbz: d + noise * (i % 2 ? -1 : 1) }) as unknown as Cell);
  for (const noise of [0, 1e-12, -1e-12]) assert.equal(trendOf(mk(noise)).label, 'steady', `noise ${noise}`);
  const clearly = [45, 44, 43, 42].map((d, i) => ({ t: T0 + i * 600, areaKm2: 50, maxDbz: d }) as unknown as Cell);
  assert.equal(trendOf(clearly).label, 'decaying');
  const growing = [40, 41, 42, 43.2].map((d, i) => ({ t: T0 + i * 600, areaKm2: 50, maxDbz: d }) as unknown as Cell);
  assert.equal(trendOf(growing).label, 'growing');
});
