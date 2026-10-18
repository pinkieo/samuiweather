import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openUvExactHourMap, stampUvIndex, uvIndexFromSpireValues } from '../lib/forecast-uv';

describe('stored UV index', () => {
  it('reads a Spire index and leaves a missing field null', () => {
    assert.equal(uvIndexFromSpireValues({ uv_index: 7.2 }), 7.2);
    assert.equal(uvIndexFromSpireValues({ ultraviolet_index: 0 }), 0);
    assert.equal(uvIndexFromSpireValues({ air_temperature: 300 }), null);
    assert.equal(uvIndexFromSpireValues(undefined), null);
  });

  it('stores OpenUV only on the exact hour and keeps a real zero', () => {
    const map = openUvExactHourMap({
      result: [
        { uv: 0, uv_time: '2026-10-18T00:00:00.000Z' },
        { uv: 8.4, uv_time: '2026-10-18T05:10:00.000Z' },
      ],
    });
    const noon = {
      valid_time_utc: '2026-10-18T05:00:00.000Z',
      uv_index: null,
      values_json: { air_temperature: 301 },
    };
    const gap = {
      valid_time_utc: '2026-10-18T06:00:00.000Z',
      uv_index: null,
      values_json: { air_temperature: 301 },
    };
    const night = {
      valid_time_utc: '2026-10-18T00:40:00.000Z',
      uv_index: null,
      values_json: { air_temperature: 298 },
    };
    stampUvIndex(noon, map);
    stampUvIndex(gap, map);
    stampUvIndex(night, map);
    assert.equal(noon.uv_index, 8.4);
    assert.equal((noon.values_json as { uv_index_source?: string }).uv_index_source, 'openuv');
    assert.equal(gap.uv_index, null);
    assert.equal((gap.values_json as { uv_index?: unknown }).uv_index, undefined);
    assert.equal(night.uv_index, 0);
  });

  it('does not replace a Spire index with OpenUV', () => {
    const map = openUvExactHourMap({
      result: [{ uv: 11, uv_time: '2026-10-18T05:00:00.000Z' }],
    });
    const row = {
      valid_time_utc: '2026-10-18T05:00:00.000Z',
      uv_index: 4,
      values_json: { uv_index: 4 },
    };
    stampUvIndex(row, map);
    assert.equal(row.uv_index, 4);
    assert.equal((row.values_json as { uv_index_source?: string }).uv_index_source, 'spire');
  });
});