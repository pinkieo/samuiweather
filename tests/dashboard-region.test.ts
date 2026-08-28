import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DASHBOARD_REGION_TAB_ORDER,
  DEFAULT_DASHBOARD_REGION_ID,
  getDashboardRegion,
} from '../lib/dashboard-regions';

describe('Samui vacation dashboard region', () => {
  it('defaults to Koh Samui, not Krabi', () => {
    assert.equal(DEFAULT_DASHBOARD_REGION_ID, 'samui');
    const region = getDashboardRegion(DEFAULT_DASHBOARD_REGION_ID);
    assert.equal(region.isSamuiProduct, true);
    assert.equal(region.weatherLocationId, 'samui_opf_hybrid');
    assert.equal(region.lat, 9.5127);
    assert.equal(region.lon, 100.0137);
  });

  it('does not put Krabi in the dashboard tab order', () => {
    assert.deepEqual(DASHBOARD_REGION_TAB_ORDER, ['samui']);
    assert.ok(!DASHBOARD_REGION_TAB_ORDER.includes('krabi_baan_mook_taley'));
  });

  it('retains Krabi region config for a later product', () => {
    const krabi = getDashboardRegion('krabi_baan_mook_taley');
    assert.equal(krabi.shortLabel, 'Krabi');
    assert.equal(krabi.isSamuiProduct, false);
  });
});
