import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeBlendDailyEntry,
  computeHourlyBlendTemp,
  computeTrailingBiases,
  ictDateFromUtcIso,
  ictHourFromUtcIso,
  isEcowittTempDayValid,
  walkForwardReplay,
  type HistoricalTempPair,
} from '../lib/v4-temperature-blend-math';

describe('v4 temperature blend math', () => {
  it('converts UTC timestamps to Asia/Bangkok date and hour', () => {
    assert.equal(ictDateFromUtcIso('2026-11-24T17:00:00Z'), '2026-11-25');
    assert.equal(ictHourFromUtcIso('2026-11-24T17:00:00Z'), 0);
    assert.equal(ictHourFromUtcIso('2026-11-25T05:00:00Z'), 12);
    assert.equal(ictDateFromUtcIso('2026-11-25T16:59:59Z'), '2026-11-25');
  });

  it('applies Ecowitt coverage gate correctly', () => {
    assert.equal(
      isEcowittTempDayValid({ sampleCount: 1436, firstMinuteIct: 1, lastMinuteIct: 1440 }),
      true,
    );
    // 9 Nov storm dropout
    assert.equal(
      isEcowittTempDayValid({ sampleCount: 691, firstMinuteIct: 0, lastMinuteIct: 794 }),
      false,
    );
    // 11 Nov late recovery
    assert.equal(
      isEcowittTempDayValid({ sampleCount: 852, firstMinuteIct: 569, lastMinuteIct: 1440 }),
      false,
    );
  });

  it('uses strictly prior trailing 30 days for bias calculation', () => {
    const pairs: HistoricalTempPair[] = [];
    for (let i = 1; i <= 35; i++) {
      const dd = String(i).padStart(2, '0');
      pairs.push({
        date: `2026-10-${dd <= '31' ? dd : '31'}`,
        obsHiC: 32,
        obsLoC: 25,
        spireHiC: i <= 5 ? 20 : 30, // first 5 days outliers, dropped once >30 days prior
        spireLoC: 28,
        ecmwfHiC: 26,
        ecmwfLoC: 22,
      });
    }
    // Fix dates cleanly across Sep/Oct
    const clean: HistoricalTempPair[] = [];
    const base = Date.parse('2026-10-01T12:00:00Z');
    for (let i = 0; i < 35; i++) {
      const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
      clean.push({
        date,
        obsHiC: 32,
        obsLoC: 25,
        spireHiC: i < 5 ? 20 : 30,
        spireLoC: 28,
        ecmwfHiC: 26,
        ecmwfLoC: 22,
      });
    }
    const targetDate = clean[34]!.date; // 35th day, 34 prior days, last 30 are indices 4..33
    const b = computeTrailingBiases(clean, targetDate, 30);
    assert.equal(b.samplesUsed, 30);
    assert.equal(b.windowFrom, clean[4]!.date);
    assert.equal(b.windowTo, clean[33]!.date);
    // index 4 had spireHiC=20 (diff +12), indices 5..33 (29 days) had spireHiC=30 (diff +2)
    // mean = (12 + 29*2) / 30 = 70 / 30 = 2.33
    assert.equal(b.spireHiBiasC, 2.33);
    assert.equal(b.spireLoBiasC, -3);
    assert.equal(b.ecmwfHiBiasC, 6);
    assert.equal(b.ecmwfLoBiasC, 3);
  });

  it('computes 50/50 daily blend with ICT 10..17 Spire max and 24h min without altering raw Spire', () => {
    const biases = {
      windowDays: 30,
      samplesUsed: 30,
      windowFrom: '2026-10-26',
      windowTo: '2026-11-24',
      spireHiBiasC: 2.17,
      spireLoBiasC: -3.0,
      ecmwfHiBiasC: 6.0,
      ecmwfLoBiasC: 3.0,
    };
    const spireHours = Array.from({ length: 24 }, (_, hr) => {
      const utcMs = Date.parse('2026-11-25T00:00:00+07:00') + hr * 3_600_000;
      return {
        timeUtc: new Date(utcMs).toISOString(),
        // Make hour 02 ICT artificially hotter than daytime to prove 10..17 filter works
        tempC: hr === 2 ? 31.0 : hr >= 10 && hr <= 17 ? 29.35 : 28.55,
      };
    });
    const ecmwfHours = Array.from({ length: 24 }, (_, hr) => {
      const utcMs = Date.parse('2026-11-25T00:00:00+07:00') + hr * 3_600_000;
      return {
        timeUtc: new Date(utcMs).toISOString(),
        tempC: hr === 14 ? 26.0 : 22.0,
      };
    });

    const entry = computeBlendDailyEntry({
      date: '2026-11-25',
      spireHours,
      ecmwfHours,
      biases,
    });
    assert.equal(entry.spireRawHiC, 29.35);
    assert.equal(entry.spireRawLoC, 28.55);
    assert.equal(entry.spireBiasCorrectedHiC, 31.52);
    assert.equal(entry.ecmwfBiasCorrectedHiC, 32.0);
    assert.equal(entry.blendHiC, 31.76);
    assert.equal(entry.spireBiasCorrectedLoC, 25.55);
    assert.equal(entry.ecmwfBiasCorrectedLoC, 25.0);
    assert.equal(entry.blendLoC, 25.28);
  });

  it('computes hourly blend alongside raw Spire and returns null when ECMWF missing', () => {
    const biases = {
      windowDays: 30,
      samplesUsed: 30,
      windowFrom: '2026-10-26',
      windowTo: '2026-11-24',
      spireHiBiasC: 2.0,
      spireLoBiasC: -3.0,
      ecmwfHiBiasC: 6.0,
      ecmwfLoBiasC: 2.0,
    };
    const day = computeHourlyBlendTemp({
      spireTempC: 29.0,
      ecmwfTempC: 26.0,
      ictHour: 14,
      biases,
    });
    // 0.5*(29+2) + 0.5*(26+6) = 0.5*31 + 0.5*32 = 31.5
    assert.equal(day.ecmwfTempRawC, 26.0);
    assert.equal(day.tempBlendC, 31.5);

    const missing = computeHourlyBlendTemp({
      spireTempC: 29.0,
      ecmwfTempC: null,
      ictHour: 14,
      biases,
    });
    assert.equal(missing.ecmwfTempRawC, null);
    assert.equal(missing.tempBlendC, null);
  });

  it('walkForwardReplay reproduces strictly lower MAE than raw Spire', () => {
    const pairs: HistoricalTempPair[] = [];
    const start = Date.parse('2026-09-25T12:00:00Z');
    for (let i = 0; i < 45; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      pairs.push({
        date,
        obsHiC: 32.0 + (i % 3) * 0.4,
        obsLoC: 25.0 + (i % 2) * 0.3,
        spireHiC: 29.5 + (i % 3) * 0.3,
        spireLoC: 28.0 + (i % 2) * 0.2,
        ecmwfHiC: 26.0 + (i % 3) * 0.4,
        ecmwfLoC: 22.0 + (i % 2) * 0.3,
      });
    }
    const r = walkForwardReplay(pairs, pairs[30]!.date, pairs[44]!.date, 30);
    assert.equal(r.metrics.n, 15);
    assert.ok(r.metrics.max.blendMaeC < r.metrics.max.rawSpireMaeC);
    assert.ok(r.metrics.min.blendMaeC < r.metrics.min.rawSpireMaeC);
  });
});

import { canonicalUtcHourIso, parseUtcMs } from '../lib/v4-temperature-blend-math';

describe('timestamp normalization', () => {
  it('parses Postgres +00 timestamps and Open-Meteo GMT timestamps identically', () => {
    const pg = canonicalUtcHourIso('2026-11-25 12:00:00+00');
    const om = canonicalUtcHourIso('2026-11-25T12:00');
    const iso = canonicalUtcHourIso('2026-11-25T12:00:00.000Z');
    assert.equal(pg, '2026-11-25T12:00:00.000Z');
    assert.equal(om, '2026-11-25T12:00:00.000Z');
    assert.equal(iso, '2026-11-25T12:00:00.000Z');
    assert.equal(parseUtcMs('2026-11-25 12:00:00+00'), Date.parse('2026-11-25T12:00:00Z'));
  });
});
