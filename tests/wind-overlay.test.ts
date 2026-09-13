import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  rasterizeWindField,
  sampleUv,
  windColorForKn,
  type WindOverlayField,
} from '../lib/wind-overlay';

function uniformField(u: number, v: number): WindOverlayField {
  return {
    source_label: 'test',
    units: 'm s**-1',
    width: 2,
    height: 2,
    west: 100,
    south: 9,
    east: 101,
    north: 10,
    u: [u, u, u, u],
    v: [v, v, v, v],
    validTime: null,
  };
}

describe('wind overlay palette', () => {
  it('uses saturated cyan at light tropical knots', () => {
    const c0 = windColorForKn(0);
    assert.ok(c0[2] > 220);
    assert.ok(c0[0] < 80);
    assert.deepEqual(windColorForKn(48), [220, 52, 52]);
    const mid = windColorForKn(6);
    assert.ok(mid[1] > 180);
  });
});

describe('wind overlay sample', () => {
  it('reads U/V on a north-first grid', () => {
    const field: WindOverlayField = {
      source_label: 'test',
      units: 'm s**-1',
      width: 2,
      height: 2,
      west: 100,
      south: 9,
      east: 101,
      north: 10,
      u: [1, 2, 3, 4],
      v: [0, 0, 0, 0],
      validTime: null,
    };
    const nw = sampleUv(field, 100.01, 9.99);
    assert.ok(nw);
    assert.ok(Math.abs(nw!.u - 1) < 0.15);
  });
});

describe('wind overlay raster', () => {
  it('paints visible colour at ~2 kn tropical breeze', () => {
    const rast = rasterizeWindField(uniformField(1, 0), 4);
    assert.ok(rast);
    const mid = ((Math.floor(rast!.height / 2) * rast!.width + Math.floor(rast!.width / 2)) * 4);
    assert.ok(rast!.data[mid + 3] > 150);
    assert.ok(rast!.data[mid + 2] > 180);
    assert.ok(rast!.data[mid] < 120);
  });
});
