import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDailyVacationBrief,
  localDateKey,
  localHour,
} from '../lib/daily-vacation-forecast';
import type { SammiDailyForecastViewRow } from '../lib/sammi-views';
import type { SamuiWeatherForecastRow } from '../lib/spire';

/** 08:00 ICT on 28 Aug 2026. */
const NOW = Date.parse('2026-08-28T01:00:00.000Z');
const DAY = '2026-08-28';

function ictIso(hour: number, day = DAY): string {
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+07:00`).toISOString();
}

function hourRow(
  hour: number,
  extra: Partial<SamuiWeatherForecastRow> = {},
): SamuiWeatherForecastRow {
  return {
    time: ictIso(hour),
    temp: 30,
    feelsLike: 33,
    windSpeed: 3.2,
    windGust: 4.1,
    windDir: 90,
    precip: 0,
    humidity: 72,
    precipRate: 0,
    uvIndex: 8,
    pm25: null,
    aqi: null,
    aqiStatus: null,
    cloudCover: 18,
    pop: 8,
    ...extra,
  };
}

function dayHours(
  start: number,
  endExclusive: number,
  extra: Partial<SamuiWeatherForecastRow> | ((hour: number) => Partial<SamuiWeatherForecastRow>) = {},
): SamuiWeatherForecastRow[] {
  const rows: SamuiWeatherForecastRow[] = [];
  for (let hour = start; hour < endExclusive; hour++) {
    const patch = typeof extra === 'function' ? extra(hour) : extra;
    rows.push(hourRow(hour, patch));
  }
  return rows;
}

describe('daily vacation brief helpers', () => {
  it('maps ICT date and hour from UTC instants', () => {
    assert.equal(localDateKey(ictIso(9)), DAY);
    assert.equal(localHour(ictIso(9)), 9);
    assert.equal(localHour(ictIso(0)), 0);
  });
});

describe('dry sunny day', () => {
  const rows = dayHours(6, 22, (hour) => ({
    temp: hour >= 12 && hour <= 14 ? 32.4 : 29.5,
    pop: 10,
    precipRate: 0,
    windSpeed: 3,
  }));

  it('names a beach window, an evening window, and no rain/thunder windows', () => {
    const brief = buildDailyVacationBrief(rows, { now: NOW });
    assert.equal(brief.confidence, 'ok');
    assert.equal(brief.stale, false);
    assert.equal(brief.verdict, 'Beach-first');
    assert.ok(brief.windows.beach, 'expected a beach window');
    assert.match(brief.windows.beach!.text, /Best beach window:/);
    assert.ok(brief.windows.evening, 'expected an evening dining window');
    assert.equal(brief.windows.rain, null);
    assert.equal(brief.windows.thunder, null);
    assert.ok(brief.conclusions.some((c) => c.startsWith('Best beach window:')));
    assert.ok(brief.conclusions.some((c) => /outdoor dinner/i.test(c)));
    assert.ok(brief.temperature.min != null && brief.temperature.max != null);
    assert.ok((brief.temperature.max ?? 0) >= (brief.temperature.min ?? 0));
  });
});

describe('rain mainly in the afternoon', () => {
  const rows = dayHours(6, 22, (hour) => {
    if (hour >= 15 && hour < 19) {
      return { pop: 62, precipRate: 0.9, precip: 0.9, cloudCover: 80 };
    }
    if (hour >= 12 && hour < 15) {
      return { pop: 28, precipRate: 0.1, cloudCover: 45 };
    }
    return { pop: 12, precipRate: 0, cloudCover: 20 };
  });

  it('keeps a morning beach window and flags rain after 15:00', () => {
    const brief = buildDailyVacationBrief(rows, { now: NOW });
    assert.equal(brief.confidence, 'ok');
    assert.ok(brief.windows.beach);
    assert.ok(brief.windows.beach!.endHourExclusive <= 15);
    assert.ok(brief.windows.rain);
    assert.match(brief.windows.rain!.text, /after 15:00/);
    assert.ok(brief.conclusions.some((c) => /after 15:00/.test(c)));
    const morning = brief.periods.find((p) => p.id === 'morning')!;
    const afternoon = brief.periods.find((p) => p.id === 'afternoon')!;
    assert.ok((morning.rainChancePct ?? 0) < (afternoon.rainChancePct ?? 0));
    assert.ok((afternoon.rainRateMmH ?? 0) >= 0.5);
  });
});

describe('rain almost all day', () => {
  const rows = dayHours(6, 22, {
    pop: 72,
    precipRate: 1.3,
    precip: 1.2,
    cloudCover: 90,
  });

  it('does not invent a beach window and treats the day as indoor/rain-aware', () => {
    const brief = buildDailyVacationBrief(rows, { now: NOW });
    assert.equal(brief.confidence, 'ok');
    assert.equal(brief.windows.beach, null);
    assert.equal(brief.windows.evening, null);
    assert.ok(brief.windows.rain);
    assert.ok(
      brief.verdict === 'Indoor-first' || brief.verdict === 'Rain-aware day',
      `unexpected verdict ${brief.verdict}`,
    );
    assert.ok(brief.conclusions.some((c) => /No clear beach window/i.test(c)));
    assert.ok(!brief.conclusions.some((c) => /Best beach window/i.test(c)));
    assert.ok(!brief.conclusions.some((c) => /outdoor dinner/i.test(c)));
  });
});

describe('thunderstorm window', () => {
  const rows = dayHours(6, 22, (hour) => {
    if (hour >= 17 && hour < 19) {
      return {
        pop: 48,
        precipRate: 0.7,
        cape: 1600,
        sammi: {
          kansRegenPctSammi: 48,
          kansOnweerPctSammi: 42,
          kansMistPctSammi: 0,
          reliability: 'high',
        },
      };
    }
    return { pop: 14, precipRate: 0, cape: 400 };
  });

  it('reports the thunder window around 17:00–19:00', () => {
    const brief = buildDailyVacationBrief(rows, { now: NOW });
    assert.equal(brief.confidence, 'ok');
    assert.ok(brief.windows.thunder);
    assert.equal(brief.windows.thunder!.startHour, 17);
    assert.equal(brief.windows.thunder!.endHourExclusive, 19);
    assert.match(brief.windows.thunder!.text, /17:00–19:00/);
    assert.ok(brief.conclusions.some((c) => /Thunderstorm risk highest around 17:00–19:00/.test(c)));
    assert.ok((brief.thunderRiskPct ?? 0) >= 40);
  });
});

describe('stale forecast', () => {
  const rows = dayHours(6, 22, { pop: 8, precipRate: 0 });

  it('withholds beach and dinner windows when provenance is stale', () => {
    const brief = buildDailyVacationBrief(rows, {
      now: NOW,
      freshness: { stale: true, ageMinutes: 180, label: '3h ago' },
    });
    assert.equal(brief.confidence, 'stale');
    assert.equal(brief.stale, true);
    assert.equal(brief.windows.beach, null);
    assert.equal(brief.windows.rain, null);
    assert.equal(brief.windows.thunder, null);
    assert.equal(brief.windows.evening, null);
    assert.ok(brief.conclusions[0].toLowerCase().includes('delayed'));
    assert.ok(!brief.conclusions.some((c) => /Best beach window/i.test(c)));
    assert.ok(!brief.conclusions.some((c) => /outdoor dinner/i.test(c)));
  });

  it('marks coverage stale when the nearest hour is more than 90 minutes old', () => {
    const brief = buildDailyVacationBrief(rows, {
      now: Date.parse('2026-08-28T16:00:00.000Z'), // 23:00 ICT; last hour is 21:00
    });
    assert.equal(brief.stale, true);
    assert.equal(brief.windows.beach, null);
    assert.equal(brief.windows.evening, null);
  });
});

describe('missing hours', () => {
  const rows = [hourRow(6), hourRow(7), hourRow(8)];

  it('shows the one hour still ahead and does not draw empty parts', () => {
    const brief = buildDailyVacationBrief(rows, { now: NOW });
    assert.equal(brief.confidence, 'ok');
    assert.equal(brief.windows.beach, null);
    assert.equal(brief.windows.evening, null);
    assert.ok(!brief.conclusions.some((c) => /too thin|no hourly data/i.test(c)));
    assert.equal(brief.periods.length, 1);
    assert.equal(brief.periods[0]!.label, 'Morning');
    assert.equal(brief.periods[0]!.hourRange, '08:00–09:00');
    assert.equal(brief.periods[0]!.rainChancePct, 8);
  });
});

describe('no clear beach window', () => {
  const rows = dayHours(6, 22, (hour) => {
    const wet = hour >= 7 && hour < 18 && hour % 2 === 1;
    return wet
      ? { pop: 55, precipRate: 0.6, precip: 0.5, cloudCover: 70 }
      : { pop: 18, precipRate: 0.05, cloudCover: 30 };
  });

  it('has enough hours but no two consecutive dry beach hours', () => {
    const brief = buildDailyVacationBrief(rows, { now: NOW });
    assert.equal(brief.confidence, 'ok');
    assert.equal(brief.windows.beach, null);
    assert.ok(brief.conclusions.some((c) => /No clear beach window/i.test(c)));
    assert.ok(!brief.conclusions.some((c) => /Best beach window/i.test(c)));
    assert.ok(brief.coverage.available >= 6);
  });
});

describe('sammi daily totals', () => {
  it('uses the highest hour still ahead and ignores the day average', () => {
    const rows = dayHours(6, 22, { pop: 12, precipRate: 0, temp: 29 });
    const sammiDaily: SammiDailyForecastViewRow = {
      location_id: 'samui_opf_hybrid',
      forecast_date: DAY,
      kans_regen_pct_sammi: 20,
      kans_onweer_pct_sammi: 5,
      kans_mist_pct_sammi: 0,
      reliability: 'high',
      sammi_advice: 'Typical island day.',
      min_temp_c: 27.1,
      max_temp_c: 33.4,
      conv_ceiling_min: 1200,
    };
    const brief = buildDailyVacationBrief(rows, { now: NOW, sammiDaily });
    assert.equal(brief.temperature.min, 29);
    assert.equal(brief.temperature.max, 29);
    assert.equal(brief.rainChancePct, 12);
    assert.doesNotMatch(brief.sourceLine, /sammi_daily_forecast/);
    assert.equal(brief.windows.beach != null, true);
  });
});

describe('rolling parts', () => {
  it('at 09:00 names morning, midday, and evening, and ignores earlier hours', () => {
    const nine = Date.parse('2026-08-28T02:00:00.000Z');
    const rows = dayHours(6, 22, (hour) => ({ pop: hour === 7 ? 80 : hour === 10 ? 33 : 10 }));
    const brief = buildDailyVacationBrief(rows, { now: nine });
    assert.deepEqual(
      brief.periods.map((p) => p.label),
      ['Morning', 'Midday', 'Evening'],
    );
    const morning = brief.periods[0]!;
    assert.equal(morning.hourRange, '09:00–12:00');
    assert.equal(morning.rainChancePct, 33);
    assert.ok(!brief.conclusions.some((c) => /no hourly data/i.test(c)));
  });

  it('at 23:31 names tonight and tomorrow, and does not use the day average', () => {
    const late = Date.parse('2026-09-25T16:31:00.000Z');
    const friday = '2026-09-25';
    const saturday = '2026-09-26';
    const rows: SamuiWeatherForecastRow[] = [
      hourRow(23, { pop: 4, temp: 29.2, time: ictIso(23, friday) }),
      hourRow(0, { pop: 16, temp: 28.4, time: ictIso(0, saturday) }),
      hourRow(3, { pop: 8, temp: 28.1, time: ictIso(3, saturday) }),
      ...dayHours(6, 12, { pop: 12, temp: 29 }).map((row, i) => ({
        ...row,
        time: ictIso(6 + i, saturday),
        pop: 6 + i === 9 ? 22 : 12,
      })),
      ...dayHours(12, 18, { pop: 10, temp: 30 }).map((row, i) => ({
        ...row,
        time: ictIso(12 + i, saturday),
        pop: 12 + i === 15 ? 40 : 10,
      })),
    ];
    const sammiDaily: SammiDailyForecastViewRow = {
      location_id: 'samui_opf_hybrid',
      forecast_date: friday,
      kans_regen_pct_sammi: 9,
      kans_onweer_pct_sammi: 13,
      kans_mist_pct_sammi: 0,
      reliability: 'high',
      sammi_advice: 'Day average only.',
      min_temp_c: 27.9,
      max_temp_c: 29.5,
    };
    const brief = buildDailyVacationBrief(rows, { now: late, sammiDaily });
    assert.deepEqual(
      brief.periods.map((p) => p.label),
      ['Tonight', 'Tomorrow morning', 'Tomorrow midday'],
    );
    assert.equal(brief.periods[0]!.rainChancePct, 16);
    assert.equal(brief.periods[1]!.rainChancePct, 22);
    assert.equal(brief.periods[2]!.rainChancePct, 40);
    assert.equal(brief.rainChancePct, 40);
    assert.ok(brief.periods.every((p) => p.hoursAvailable > 0));
    assert.ok(!JSON.stringify(brief).includes('too thin'));
    assert.ok(!JSON.stringify(brief).includes('No hourly data'));
  });
});

describe('overnight OPF spike is not a vacation window', () => {
  it('does not name a 02:00 thunder or fog window from an isolated 100% hour', () => {
    const rows = dayHours(0, 22, (hour) => {
      if (hour === 2) {
        return {
          pop: 2,
          precipRate: 0,
          cape: 700,
          sammi: {
            kansRegenPctSammi: 2,
            kansOnweerPctSammi: 100,
            kansMistPctSammi: 0,
            reliability: 'high',
          },
        };
      }
      if (hour === 21) {
        return {
          pop: 8,
          precipRate: 0,
          sammi: {
            kansRegenPctSammi: 8,
            kansOnweerPctSammi: 16,
            kansMistPctSammi: 100,
            reliability: 'high',
          },
        };
      }
      return { pop: 10, precipRate: 0, cape: 400 };
    });
    const brief = buildDailyVacationBrief(rows, { now: NOW });
    assert.equal(brief.windows.thunder, null);
    assert.equal(brief.fog.relevant, false);
    assert.ok(!brief.conclusions.some((c) => /02:00/.test(c)));
    assert.ok(!brief.conclusions.some((c) => /Fog/i.test(c)));
    assert.ok(brief.windows.beach);
  });
});

describe('Sammi daily paragraph', () => {
  const rows = dayHours(6, 22, (hour) => ({
    temp: hour >= 12 && hour <= 14 ? 32.4 : 29.5,
    pop: 10,
    precipRate: 0,
    windSpeed: 3,
  }));

  it('uses a fresh dry gauge and the same day figures as Coming up', () => {
    const brief = buildDailyVacationBrief(rows, {
      now: NOW,
      nowReading: { fresh: true, tempC: 28.2, rainRateMmh: 0, windSpeedMs: 2 },
    });
    assert.equal(brief.verdict, 'Beach-first');
    assert.equal(
      brief.summary,
      'Right now 28°C, dry on the gauge. Day: about 30\u201332°C, chance of rain up to 10%, wind up to 3 m/s. Normal tourist day.',
    );
  });

  it('says raining on the gauge without changing the forecast hours', () => {
    const brief = buildDailyVacationBrief(rows, {
      now: NOW,
      nowReading: { fresh: true, tempC: 27.6, rainRateMmh: 0.4, windSpeedMs: 2 },
    });
    assert.equal(brief.verdict, 'Beach-first');
    assert.match(brief.summary, /^Right now 28°C, raining on the gauge\./);
    assert.match(brief.summary, /chance of rain up to 10%/);
  });

  it('uses the current forecast hour when the station is late', () => {
    const brief = buildDailyVacationBrief(rows, {
      now: NOW,
      nowReading: { fresh: false, late: true, tempC: 22, rainRateMmh: 0, windSpeedMs: 9 },
    });
    assert.equal(
      brief.summary,
      'The station reading is late. The current hour is 30°C with wind 3 m/s. Day: about 30\u201332°C, chance of rain up to 10%, wind up to 3 m/s. Normal tourist day.',
    );
    assert.doesNotMatch(brief.summary, /gauge/);
    assert.doesNotMatch(brief.summary, /22°C/);
  });

  it('uses the late wording when the station is missing', () => {
    const brief = buildDailyVacationBrief(rows, { now: NOW, nowReading: null });
    assert.match(brief.summary, /^The station reading is late\. The current hour is 30°C with wind 3 m\/s\./);
  });

  it('is only the delayed line when the forecast is stale', () => {
    const brief = buildDailyVacationBrief(rows, {
      now: NOW,
      freshness: { stale: true, ageMinutes: 180, label: '3h ago' },
      nowReading: { fresh: true, tempC: 28, rainRateMmh: 0, windSpeedMs: 2 },
    });
    assert.equal(brief.summary, 'Forecast is delayed.');
    assert.doesNotMatch(brief.summary, /beach|dinner|Normal tourist|gauge/i);
  });

  it('names a light shower backup on a flexible day', () => {
    const flexible = dayHours(6, 22, { pop: 28, precipRate: 0.1, windSpeed: 4.2, temp: 29 });
    const brief = buildDailyVacationBrief(flexible, {
      now: NOW,
      nowReading: { fresh: true, tempC: 29, rainRateMmh: 0, windSpeedMs: 3 },
    });
    assert.equal(brief.verdict, 'Flexible day');
    assert.match(brief.summary, /Right now 29°C, dry on the gauge\./);
    assert.match(brief.summary, /chance of rain up to 28%, wind up to 4 m\/s\. Normal tourist day with a light shower backup\.$/);
  });

  it('names an indoor-first day from the forecast, not the gauge', () => {
    const indoor = dayHours(6, 22, { pop: 80, precipRate: 2.5, precip: 2.5, windSpeed: 6, temp: 27 });
    const brief = buildDailyVacationBrief(indoor, {
      now: NOW,
      nowReading: { fresh: true, tempC: 27, rainRateMmh: 0, windSpeedMs: 2 },
    });
    assert.equal(brief.verdict, 'Indoor-first');
    assert.match(brief.summary, /dry on the gauge\./);
    assert.match(brief.summary, /Indoor-first day\.$/);
  });
});
