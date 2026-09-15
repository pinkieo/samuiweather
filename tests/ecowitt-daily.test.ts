import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ictDayUtcRange,
  parseIctDateYmd,
  summarizeEcowittDay,
  yesterdayIctDate,
  type EcowittDaySample,
} from '../lib/ecowitt-data';
import {
  bucketStationHours,
  scoreForecastDay,
  type ForecastHour,
} from '../lib/forecast-day-accuracy';
import { eachIctDay } from '../lib/forecast-accuracy-trend';

describe('ICT day range', () => {
  it('maps 2026-09-12 ICT onto 11th 17:00Z .. 12th 17:00Z', () => {
    const range = ictDayUtcRange('2026-09-12');
    assert.ok(range);
    assert.equal(range!.startUtc.toISOString(), '2026-09-11T17:00:00.000Z');
    assert.equal(range!.endUtc.toISOString(), '2026-09-12T17:00:00.000Z');
  });

  it('rejects junk dates', () => {
    assert.equal(parseIctDateYmd('12-09-2026'), null);
    assert.equal(ictDayUtcRange('nope'), null);
  });

  it('yesterday is the previous ICT calendar day', () => {
    assert.equal(yesterdayIctDate(new Date('2026-09-13T03:00:00.000Z')), '2026-09-12');
  });

  it('lists inclusive ICT days', () => {
    assert.deepEqual(eachIctDay('2026-09-11', '2026-09-13'), [
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
  });
});

describe('station day summary', () => {
  it('uses max rain_day_mm and min/max temperature', () => {
    const rows: EcowittDaySample[] = [
      {
        observed_at: '2026-09-11T18:00:00.000Z',
        temperature_c: 26,
        humidity_pct: 80,
        wind_speed_ms: 1.2,
        wind_gust_ms: 2,
        rain_rate_mmh: 0.4,
        rain_day_mm: 2.1,
        solar_wm2: 100,
        uv_index: 1,
      },
      {
        observed_at: '2026-09-12T08:00:00.000Z',
        temperature_c: 31.5,
        humidity_pct: 70,
        wind_speed_ms: 3.8,
        wind_gust_ms: 5,
        rain_rate_mmh: 8.2,
        rain_day_mm: 12.4,
        solar_wm2: 700,
        uv_index: 9,
      },
      {
        observed_at: '2026-09-12T16:50:00.000Z',
        temperature_c: 24.2,
        humidity_pct: 92,
        wind_speed_ms: 0.8,
        wind_gust_ms: 1.4,
        rain_rate_mmh: 0,
        rain_day_mm: 12.4,
        solar_wm2: 0,
        uv_index: 0,
      },
    ];
    const sum = summarizeEcowittDay(rows, '2026-09-12');
    assert.equal(sum.available, true);
    assert.equal(sum.sampleCount, 3);
    assert.equal(sum.temperatureMinC, 24.2);
    assert.equal(sum.temperatureMaxC, 31.5);
    assert.equal(sum.rainDayMm, 12.4);
    assert.equal(sum.windMaxMs, 3.8);
  });

  it('marks an empty day unavailable', () => {
    const sum = summarizeEcowittDay([], '2026-09-11');
    assert.equal(sum.available, false);
    assert.equal(sum.sampleCount, 0);
    assert.equal(sum.rainDayMm, null);
  });
});

describe('forecast day score', () => {
  it('pairs hourly means and day rain', () => {
    const station = summarizeEcowittDay(
      [
        {
          observed_at: '2026-09-12T01:10:00.000Z',
          temperature_c: 28,
          humidity_pct: 75,
          wind_speed_ms: 2,
          wind_gust_ms: 3,
          rain_rate_mmh: 0,
          rain_day_mm: 4,
          solar_wm2: null,
          uv_index: null,
        },
        {
          observed_at: '2026-09-12T01:40:00.000Z',
          temperature_c: 30,
          humidity_pct: 75,
          wind_speed_ms: 2,
          wind_gust_ms: 3,
          rain_rate_mmh: 0,
          rain_day_mm: 4,
          solar_wm2: null,
          uv_index: null,
        },
      ],
      '2026-09-12',
    );
    const hours = bucketStationHours([
      {
        observed_at: '2026-09-12T01:10:00.000Z',
        temperature_c: 28,
        humidity_pct: 75,
        wind_speed_ms: 2,
        wind_gust_ms: 3,
        rain_rate_mmh: 0,
        rain_day_mm: 4,
        solar_wm2: null,
        uv_index: null,
      },
      {
        observed_at: '2026-09-12T01:40:00.000Z',
        temperature_c: 30,
        humidity_pct: 75,
        wind_speed_ms: 2,
        wind_gust_ms: 3,
        rain_rate_mmh: 0,
        rain_day_mm: 4,
        solar_wm2: null,
        uv_index: null,
      },
    ]);
    const forecast: ForecastHour[] = [
      {
        validTimeUtc: '2026-09-12T01:00:00.000Z',
        issuedAtUtc: null,
        tempC: 31,
        humidityPct: 70,
        windMs: 3,
        precipRate: 3.5,
        pop1h: 80,
      },
    ];
    const score = scoreForecastDay(station, hours, forecast);
    assert.equal(score.hoursPaired, 1);
    assert.equal(score.tempMaeC, 2);
    assert.equal(score.tempBiasC, 2);
    assert.equal(score.rainYesNoMatch, true);
    assert.equal(score.stationRainDayMm, 4);
  });
});
