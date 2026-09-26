import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  blendEcowittIntoFirstRow,
  blendReferenceNowcastIntoFirstRow,
} from '../lib/forecast-reference';
import type { SamuiWeatherForecastRow } from '../lib/spire';

function row(pop: number): SamuiWeatherForecastRow {
  return {
    time: '2026-09-25T16:00:00.000Z',
    temp: 29.2,
    feelsLike: 31,
    windSpeed: 3.7,
    windGust: 5,
    windDir: 207,
    precip: 0,
    humidity: 70,
    precipRate: 0,
    uvIndex: 0,
    pm25: null,
    aqi: null,
    aqiStatus: null,
    cloudCover: 20,
    pop,
  };
}

describe('forecast hour stays Spire', () => {
  it('does not raise rain chance from a private now-cast', () => {
    const rows = [row(4)];
    const out = blendReferenceNowcastIntoFirstRow(rows, {
      tempC: 29.3,
      windSpeedMs: 0.51,
      windDirDeg: 240,
      precipMm: 0.3,
    });
    assert.equal(out[0]!.pop, 4);
    assert.equal(out[0]!.temp, 29.2);
    assert.equal(out[0]!.windSpeed, 3.7);
    assert.equal(out[0]!.precipRate, 0);
  });

  it('does not leave a raised rain chance after a dry station reading', () => {
    const rows = [row(4)];
    const out = blendEcowittIntoFirstRow(rows, {
      observedAt: new Date().toISOString(),
      tempC: 26.5,
      humidityPct: 88,
      windSpeedMs: 0.8,
      windDirDeg: 157,
      rainRateMmh: 0,
      uvIndex: 0,
    });
    assert.equal(out[0]!.pop, 4);
    assert.equal(out[0]!.temp, 29.2);
    assert.equal(out[0]!.precipRate, 0);
  });
});
