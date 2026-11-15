/**
 * Service / route behaviour with a mocked RainViewer upstream (no network):
 * explicit "unavailable" states on every failure mode, hedged "ok" payload end-to-end through PNG decode, route status codes.
 * Run: npx tsx --test tests/nowcast-service.test.ts
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { getNowcast, resetNowcastCache } from '../lib/nowcast/service';
import { UNIVERSAL_BLUE } from '../lib/nowcast/palette';
import { GET } from '../app/api/nowcast/route';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetNowcastCache();
});

const BY_DBZ = new Map(UNIVERSAL_BLUE.map(([d, r, g, b, a]) => [d, [r, g, b, a] as const]));

/** 256x256 palette PNG with a Gaussian-ish rain blob centred at (cx, cy) px. */
function tilePng(cx: number, cy: number): Buffer {
  const png = new PNG({ width: 256, height: 256 });
  png.data.fill(0);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const v = 45 - 25 * (Math.hypot(x - cx, y - cy) / 6) ** 2;
      if (v >= 5) png.data.set(BY_DBZ.get(Math.round(v)) as readonly number[], (y * 256 + x) * 4);
    }
  return PNG.sync.write(png);
}

function mockUpstream(opts: { catalog?: unknown; catalogStatus?: number; tileFail?: (t: number) => boolean; times?: number[] }) {
  const times = opts.times ?? [0, 1, 2, 3, 4, 5, 6].map((i) => 1_794_700_000 + i * 600);
  const nowMs = (times[times.length - 1] + 240) * 1000;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('weather-maps.json')) {
      if (opts.catalogStatus && opts.catalogStatus !== 200) return new Response('nope', { status: opts.catalogStatus });
      return Response.json(
        opts.catalog ?? { version: '2.0', generated: times[times.length - 1], host: 'https://tilecache.rainviewer.com', radar: { past: times.map((t) => ({ time: t, path: `/v2/radar/${t}` })) } },
      );
    }
    const m = url.match(/\/v2\/radar\/(\d+)\/256\/7\/99\/60\/2\/0_0\.png$/);
    assert.ok(m, `unexpected URL ${url}`);
    const t = Number(m[1]);
    if (opts.tileFail?.(t)) return new Response('x', { status: 500 });
    const i = times.indexOf(t);
    return new Response(new Uint8Array(tilePng(40 + 6 * i, 150)), { status: 200, headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
  return nowcastTimeMs(nowMs);
}
const nowcastTimeMs = (ms: number) => ms;

test('upstream catalog failure => explicit unavailable (no data invented)', async () => {
  const now = mockUpstream({ catalogStatus: 500 });
  const r = await getNowcast(now);
  assert.equal(r.status, 'unavailable');
  if (r.status === 'unavailable') assert.equal(r.reason, 'catalog_failed');
});

test('malformed catalog => unavailable catalog_invalid', async () => {
  const now = mockUpstream({ catalog: { radar: {} } });
  const r = await getNowcast(now);
  assert.equal(r.status, 'unavailable');
  if (r.status === 'unavailable') assert.equal(r.reason, 'catalog_invalid');
});

test('all tiles fail => unavailable no_frames', async () => {
  const now = mockUpstream({ tileFail: () => true });
  const r = await getNowcast(now);
  assert.equal(r.status, 'unavailable');
  if (r.status === 'unavailable') assert.equal(r.reason, 'no_frames');
});

test('too few real frames => unavailable insufficient_frames', async () => {
  const times = [1_794_700_000, 1_794_700_600];
  const now = mockUpstream({ times });
  const r = await getNowcast(now);
  assert.equal(r.status, 'unavailable');
  if (r.status === 'unavailable') assert.equal(r.reason, 'insufficient_frames');
});

test('ok end-to-end through PNG decode: hedged per-cell verdict, Bangkok time, failed frames reported', async () => {
  const times = [0, 1, 2, 3, 4, 5, 6].map((i) => 1_794_700_000 + i * 600);
  const now = mockUpstream({ times, tileFail: (t) => t === times[2] });
  const r = await getNowcast(now);
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.equal(r.experimental, true);
  assert.equal(r.frame.published, 7);
  assert.equal(r.frame.decoded, 6);
  assert.equal(r.frame.failed, 1);
  assert.equal(r.frame.stale, false);
  assert.ok(r.cells.length >= 1);
  assert.match(r.verdict.text, /Showers|Isolated shower|Heavy cell|Rain area|Band|No rain within 70 km/);
  assert.match(r.frame.newestIct, /^\d\d:\d\d$/);
});

test('route: 503 + unavailable JSON on failure; 200 + ok JSON otherwise; never cached', async () => {
  let now = mockUpstream({ catalogStatus: 500 });
  const realNow = Date.now;
  Date.now = () => now;
  try {
    let res = await GET();
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(((await res.json()) as { status: string }).status, 'unavailable');
    now = mockUpstream({});
    resetNowcastCache();
    res = await GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; experimental: boolean };
    assert.equal(body.status, 'ok');
    assert.equal(body.experimental, true);
  } finally {
    Date.now = realNow;
  }
});
