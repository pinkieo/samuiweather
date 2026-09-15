import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyLockOnce,
  currentOverviewSlot,
  nextOverviewSlot,
  previousOverviewSlot,
  rainCounterDelta,
  scoreSlotWindow,
  slotStartUtc,
  touristSummary,
  type OverviewHour,
  type SlotLockRecord,
} from '../lib/forecast-overview';
import type { EcowittDaySample } from '../lib/ecowitt-data';

describe('overview slots', () => {
  it('floors ICT time onto 00/06/12/18', () => {
    assert.deepEqual(currentOverviewSlot(new Date('2026-09-15T00:10:00+07:00')), {
      date: '2026-09-15',
      slot: '0000',
    });
    assert.deepEqual(currentOverviewSlot(new Date('2026-09-15T07:00:00+07:00')), {
      date: '2026-09-15',
      slot: '0600',
    });
    assert.deepEqual(currentOverviewSlot(new Date('2026-09-15T18:00:00+07:00')), {
      date: '2026-09-15',
      slot: '1800',
    });
  });

  it('walks previous/next across midnight ICT', () => {
    assert.deepEqual(previousOverviewSlot('2026-09-15', '0000'), {
      date: '2026-09-14',
      slot: '1800',
    });
    assert.deepEqual(nextOverviewSlot('2026-09-15', '1800'), {
      date: '2026-09-16',
      slot: '0000',
    });
    assert.equal(slotStartUtc('2026-09-15', '0600').toISOString(), '2026-09-14T23:00:00.000Z');
    assert.equal(slotStartUtc('2026-09-16', '0000').toISOString(), '2026-09-15T17:00:00.000Z');
  });

  it('after 18:00 ICT the current lock is 1800 and 06/12/18 are the same ICT date', () => {
    const now = currentOverviewSlot(new Date('2026-09-15T19:05:00+07:00'));
    assert.deepEqual(now, { date: '2026-09-15', slot: '1800' });
    const midday = previousOverviewSlot(now.date, now.slot);
    const morning = previousOverviewSlot(midday.date, midday.slot);
    assert.deepEqual(midday, { date: '2026-09-15', slot: '1200' });
    assert.deepEqual(morning, { date: '2026-09-15', slot: '0600' });
  });
});

describe('slot lock idempotency', () => {
  const first: SlotLockRecord = {
    locationId: 'samui_opf_hybrid',
    date: '2026-09-15',
    slot: '0600',
    issuanceTimeUtc: '2026-09-14T23:05:00.000Z',
    retrievedAtUtc: '2026-09-14T23:05:00.000Z',
    forecastJson: { hours: [{ tempC: 28 }], pop1hMaxPct: 40 },
    verificationJson: null,
  };

  it('inserts the first lock and ignores a second forecast blob for the same slot', () => {
    const once = applyLockOnce(null, first);
    assert.equal(once.duplicated, false);
    const again = applyLockOnce(once.record, {
      ...first,
      issuanceTimeUtc: '2026-09-14T23:40:00.000Z',
      forecastJson: { hours: [{ tempC: 99 }], pop1hMaxPct: 1 },
    });
    assert.equal(again.duplicated, true);
    assert.equal(again.record.issuanceTimeUtc, first.issuanceTimeUtc);
    assert.deepEqual(again.record.forecastJson, first.forecastJson);
  });

  it('may attach verification later without duplicating the row identity', () => {
    const locked = applyLockOnce(null, first).record;
    const scored = applyLockOnce(locked, {
      ...first,
      verificationJson: {
        windowStartUtc: 'x',
        windowEndUtc: 'y',
        stationSampleCount: 10,
        stationTempMinC: 26,
        stationTempMaxC: 30,
        stationTempMeanC: 28,
        forecastTempMinC: 27,
        forecastTempMaxC: 29,
        forecastTempMeanC: 28.2,
        tempMeanErrorC: 0.2,
        stationRainDeltaMm: 1,
        stationRainRateMaxMmh: 0.4,
        stationRainDayMmEnd: 1,
        forecastPrecipSumMm: 2.2,
        forecastPop1hMeanPct: 40,
        forecastPop1hMaxPct: 55,
        forecastThunderMeanPct: 10,
        thunderObservable: false,
        rainSkillNote: 'uncalibrated',
      },
    });
    assert.equal(scored.duplicated, true);
    assert.equal(scored.record.verificationJson?.stationRainDeltaMm, 1);
    assert.deepEqual(scored.record.forecastJson, first.forecastJson);
  });
});

describe('rain counter delta', () => {
  it('uses the daily counter increase and survives midnight reset', () => {
    const rows: EcowittDaySample[] = [
      {
        observed_at: '2026-09-14T16:30:00.000Z',
        temperature_c: 28,
        humidity_pct: 80,
        wind_speed_ms: 1,
        wind_gust_ms: 2,
        rain_rate_mmh: 0.2,
        rain_day_mm: 10,
        solar_wm2: null,
        uv_index: null,
      },
      {
        observed_at: '2026-09-14T16:50:00.000Z',
        temperature_c: 27,
        humidity_pct: 82,
        wind_speed_ms: 1,
        wind_gust_ms: 2,
        rain_rate_mmh: 1,
        rain_day_mm: 12.4,
        solar_wm2: null,
        uv_index: null,
      },
      {
        observed_at: '2026-09-14T17:10:00.000Z',
        temperature_c: 26,
        humidity_pct: 90,
        wind_speed_ms: 1,
        wind_gust_ms: 2,
        rain_rate_mmh: 0.4,
        rain_day_mm: 0.8,
        solar_wm2: null,
        uv_index: null,
      },
    ];
    assert.equal(rainCounterDelta(rows), 2.4);
  });
});

describe('slot accuracy', () => {
  it('logs raw rain numbers and does not invent a wet/dry match', () => {
    const hours: OverviewHour[] = [
      {
        validTimeUtc: '2026-09-15T00:00:00.000Z',
        leadHours: 1,
        tempC: 29,
        humidityPct: 70,
        windMs: 3,
        precipRate: 2,
        pop1h: 80,
        pop24h: 90,
        thunderPct: 20,
        fogPct: 0,
        opfOverlayApplied: true,
      },
    ];
    const station: EcowittDaySample[] = [
      {
        observed_at: '2026-09-15T00:10:00.000Z',
        temperature_c: 28,
        humidity_pct: 80,
        wind_speed_ms: 1,
        wind_gust_ms: 2,
        rain_rate_mmh: 0.1,
        rain_day_mm: 1,
        solar_wm2: null,
        uv_index: null,
      },
    ];
    const acc = scoreSlotWindow(
      station,
      hours,
      new Date('2026-09-15T00:00:00.000Z'),
      new Date('2026-09-15T06:00:00.000Z'),
    );
    assert.equal(acc.thunderObservable, false);
    assert.equal(acc.stationRainDeltaMm, 0);
    assert.ok(acc.forecastPrecipSumMm != null);
    assert.equal('rainYesNoMatch' in acc, false);
    assert.ok(acc.rainSkillNote.includes('double'));
  });
});

describe('tourist copy', () => {
  it('says chance of rain, not POP', () => {
    const hours: OverviewHour[] = [
      {
        validTimeUtc: '2026-09-15T04:00:00.000Z',
        leadHours: 2,
        tempC: 30,
        humidityPct: 70,
        windMs: 2,
        precipRate: 0.2,
        pop1h: 55,
        pop24h: 60,
        thunderPct: 10,
        fogPct: 0,
        opfOverlayApplied: true,
      },
    ];
    const t = touristSummary(hours, '0600');
    assert.equal(/POP/i.test(t.headline + t.periods.map((p) => p.text).join(' ')), false);
    assert.ok(/rain/i.test(t.headline + t.periods.map((p) => p.text).join(' ')));
  });
});
