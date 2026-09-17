import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SPIRE_RDAS_FEED,
  alignRdasHour,
  arange,
  extractWindUv,
  overlayAxes,
  routedataBody,
  validTimeIsoZ,
  windUvMs,
} from '../lib/theyr-rdas-wind';

describe('Theyr RDAS Spire wind', () => {
  it('snaps valid time to 3-hour RDAS hours', () => {
    const t = alignRdasHour(new Date('2026-09-17T08:40:00Z'));
    assert.equal(t.toISOString(), '2026-09-17T09:00:00.000Z');
    assert.equal(validTimeIsoZ(new Date('2026-09-17T08:40:00Z')), '2026-09-17T09:00:00Z');
    assert.equal(validTimeIsoZ(new Date('2026-09-17T07:00:00Z')), '2026-09-17T06:00:00Z');
  });

  it('builds a Gulf of Thailand grid under RouteData max points', () => {
    const { lats, lons } = overlayAxes();
    assert.ok(lats[0]! > lats[lats.length - 1]!);
    assert.equal(lons[0], 98.5);
    assert.ok(lats.length * lons.length < 4096);
    assert.deepEqual(arange(8, 8.5, 0.25), [8, 8.25, 8.5]);
  });

  it('posts the Spire dataFeed and excludes non-wind', () => {
    const body = routedataBody([{ lat: 9.5, lon: 100.0, t: '2026-09-17T09:00:00Z' }]);
    const options = body.options as {
      dataFeed: { id: string };
      filter: string[];
    };
    assert.equal(options.dataFeed.id, SPIRE_RDAS_FEED);
    assert.ok(options.filter.includes('wave'));
    assert.ok(!options.filter.includes('wind'));
  });

  it('converts meteorological FROM to u/v m/s', () => {
    const north = windUvMs(1.943844, 0);
    assert.ok(Math.abs(north.u) < 0.02);
    assert.ok(north.v < -0.9);
    const east = windUvMs(1.943844, 90);
    assert.ok(east.u < -0.9);
    assert.ok(Math.abs(east.v) < 0.02);
  });

  it('extracts a north-first u/v grid from RouteData points', () => {
    const lats = [10, 9.75];
    const lons = [100, 100.25];
    const payload = {
      dataPoints: [
        {
          lat: 10,
          lon: 100,
          data: { wind: { values: [{ speed: 10, direction: 90 }] } },
        },
        {
          lat: 9.75,
          lon: 100.25,
          data: { wind: { values: [{ speed: 20, direction: 0 }] } },
        },
      ],
    };
    const grid = extractWindUv(payload, lats, lons);
    assert.equal(grid.usable, 2);
    assert.equal(grid.missing, 2);
    assert.ok(grid.u[0]! < 0);
    assert.ok(Math.abs(grid.v[0]!) < 0.2);
    assert.ok(Math.abs(grid.u[3]!) < 0.3);
    assert.ok(grid.v[3]! < 0);
  });
});
