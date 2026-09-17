import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { flattenForDb } from '../lib/weather-ingest';

describe('flattenForDb', () => {
  it('maps Spire kelvin and OPF fractions onto weather_forecast columns', () => {
    const flat = flattenForDb(
      'samui_opf_hybrid',
      {
        times: {
          valid_time: '2026-09-17T01:00:00Z',
          issuance_time: '2026-09-16T12:00:00Z',
        },
        values: {
          air_temperature: 301.15,
          wind_speed: 6.2,
          probability_of_precipitation_1hr: 0.2,
          probability_of_thunderstorm: 1,
          precipitation_rate: 0,
        },
      },
      'clear',
      false,
    );
    assert.ok(flat);
    assert.equal(flat.location_id, 'samui_opf_hybrid');
    assert.equal(flat.air_temperature_c, 28);
    assert.equal(flat.wind_speed_ms, 6.2);
    assert.equal(flat.probability_of_precipitation_1hr, 20);
    assert.equal(flat.probability_of_thunderstorm, 100);
    assert.equal(flat.radar_status, 'clear');
  });
});
