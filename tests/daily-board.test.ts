import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bucketStationHours } from '../lib/forecast-day-accuracy';
import {
  applyTemperatureBias,
  bestForToday,
  buildDailyBoard,
  type BoardHourInput,
  ictHourFromUtc,
  normalizeChancePercent,
  normalizeCloudPercent,
  pairsFromHours,
  rainLikelihoodWords,
  showerShade,
  skyFromSignals,
  temperatureBiasByIctHour,
  thunderRiskFromCape,
  BIAS_MIN_SAMPLES,
} from '../lib/daily-board';
import { GARDEN_STATION, MAP_H, MAP_W } from '../lib/daily-board-map';
import { sampleDailyBoard, sampleTemperaturePairs } from '../lib/daily-board-sample';
import { loadDailyBoard } from '../lib/daily-board-load';
import type { EcowittDaySample } from '../lib/ecowitt-data';

const DAY = '2026-10-17';

function at(hour: number, day = DAY): string {
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+07:00`).toISOString();
}

function hour(hourNum: number, extra: Partial<BoardHourInput> = {}): BoardHourInput {
  return {
    timeUtc: at(hourNum),
    tempC: 30,
    rainChancePct: 10,
    cloudCoverPct: 20,
    capeJkg: 200,
    windMs: 3,
    uvIndex: 6,
    ...extra,
  };
}

function dayHours(
  patch: (hourNum: number) => Partial<BoardHourInput> = () => ({}),
): BoardHourInput[] {
  const rows: BoardHourInput[] = [];
  for (let h = 6; h < 22; h++) rows.push(hour(h, patch(h)));
  return rows;
}

function guestText(board: ReturnType<typeof buildDailyBoard>): string {
  return [
    board.bestForToday,
    board.biasSummary,
    board.credit,
    board.mapCaption,
    ...board.blocks.flatMap((b) => [b.rainWords ?? '', b.tempLabel]),
    ...board.hours.flatMap((h) => [h.rainLabel, h.thunderLabel, h.uvLabel, h.windLabel]),
  ].join(' ');
}

describe('temperature bias', () => {
  it('warms a cool afternoon forecast and cools a warm morning forecast', () => {
    const pairs = [];
    for (let day = 1; day <= 5; day++) {
      const date = `2026-10-${String(10 + day).padStart(2, '0')}`;
      pairs.push({
        validTimeUtc: at(7, date),
        forecastTempC: 28,
        stationTempC: 26.2,
      });
      pairs.push({
        validTimeUtc: at(15, date),
        forecastTempC: 29,
        stationTempC: 31.5,
      });
    }
    const bias = temperatureBiasByIctHour(pairs);
    const morning = bias.find((b) => b.ictHour === 7)!;
    const afternoon = bias.find((b) => b.ictHour === 15)!;
    assert.ok(morning.biasC != null && morning.biasC > 1);
    assert.ok(afternoon.biasC != null && afternoon.biasC < -2);
    const cooled = applyTemperatureBias(27, morning.biasC);
    const warmed = applyTemperatureBias(29, afternoon.biasC);
    assert.ok(cooled.corrected && cooled.tempC != null && cooled.tempC < 27);
    assert.ok(warmed.corrected && warmed.tempC != null && warmed.tempC > 29);
  });

  it('does not invent a correction when the sample is thin or the temperature is missing', () => {
    const thin = temperatureBiasByIctHour(
      Array.from({ length: BIAS_MIN_SAMPLES - 1 }, (_, i) => ({
        validTimeUtc: at(15, `2026-10-${String(10 + i).padStart(2, '0')}`),
        forecastTempC: 29,
        stationTempC: 32,
      })),
    );
    assert.equal(thin[0]?.biasC, null);
    assert.deepEqual(applyTemperatureBias(29, null), { tempC: 29, corrected: false });
    assert.deepEqual(applyTemperatureBias(null, -2.5), { tempC: null, corrected: false });
  });

  it('drops a wild pair and pairs station hours on the UTC hour', () => {
    const pairs = [];
    for (let day = 1; day <= 4; day++) {
      pairs.push({
        validTimeUtc: at(15, `2026-10-${String(10 + day).padStart(2, '0')}`),
        forecastTempC: 30,
        stationTempC: 31,
      });
    }
    pairs.push({
      validTimeUtc: at(15, '2026-10-16'),
      forecastTempC: 30,
      stationTempC: 10,
    });
    const bias = temperatureBiasByIctHour(pairs);
    assert.equal(bias[0]?.samples, 4);
    assert.equal(bias[0]?.biasC, -1);

    const sample: EcowittDaySample = {
      observed_at: '2026-10-16T08:10:00.000Z',
      temperature_c: 26.4,
      humidity_pct: null,
      wind_speed_ms: null,
      wind_gust_ms: null,
      rain_rate_mmh: null,
      rain_day_mm: null,
      solar_wm2: null,
      uv_index: null,
    };
    const paired = pairsFromHours(
      [{ validTimeUtc: '2026-10-16T08:00:00.000Z', tempC: 28 }],
      bucketStationHours([sample]),
    );
    assert.equal(paired.length, 1);
    assert.equal(paired[0]?.stationTempC, 26.4);
    assert.equal(ictHourFromUtc('2026-10-16T08:00:00.000Z'), 15);
  });
});

describe('icons and rain wording', () => {
  it('picks sun, cloud, shower, and thunder without treating a missing field as zero', () => {
    assert.equal(
      skyFromSignals({ rainChancePct: 8, cloudCoverPct: 15, thunderRisk: 'low' }),
      'sun',
    );
    assert.equal(
      skyFromSignals({ rainChancePct: 10, cloudCoverPct: 70, thunderRisk: 'low' }),
      'cloud',
    );
    assert.equal(
      skyFromSignals({ rainChancePct: 55, cloudCoverPct: 40, thunderRisk: 'low' }),
      'shower',
    );
    assert.equal(
      skyFromSignals({ rainChancePct: 50, cloudCoverPct: 40, thunderRisk: 'higher' }),
      'thunder',
    );
    assert.equal(
      skyFromSignals({ rainChancePct: null, cloudCoverPct: null, thunderRisk: null }),
      'unavailable',
    );
    assert.equal(showerShade(null), 'unavailable');
    assert.equal(rainLikelihoodWords(null), null);
    assert.equal(rainLikelihoodWords(0), 'Mostly dry');
    assert.equal(rainLikelihoodWords(58), 'Showers likely');
    assert.doesNotMatch(rainLikelihoodWords(80) ?? '', /mm|millimetre/i);
  });

  it('bases thunder on CAPE and leaves it unavailable when CAPE is missing', () => {
    assert.equal(thunderRiskFromCape(null, 80), null);
    assert.equal(thunderRiskFromCape(1600, 40), 'higher');
    assert.equal(thunderRiskFromCape(900, 20), 'possible');
    assert.equal(thunderRiskFromCape(1200, null), 'possible');
    assert.equal(thunderRiskFromCape(200, 5), 'low');
    assert.equal(thunderRiskFromCape(0, 0), 'low');
  });

  it('reads leftover fractions without turning 1% into 100%', () => {
    assert.equal(normalizeChancePercent(0.2), 20);
    assert.equal(normalizeChancePercent(1), 1);
    assert.equal(normalizeChancePercent(null), null);
    assert.equal(normalizeCloudPercent(0.25), 25);
    assert.equal(normalizeCloudPercent(1), 100);
    assert.equal(normalizeCloudPercent(40), 40);
  });
});

describe('daily board shaping', () => {
  it('builds four blocks and keeps a missing hour blank', () => {
    const board = buildDailyBoard({
      dateYmd: DAY,
      hours: dayHours().filter((row) => ictHourFromUtc(row.timeUtc) !== 9),
      bias: [],
      mode: 'live',
    });
    assert.deepEqual(
      board.blocks.map((b) => b.id),
      ['morning', 'midday', 'afternoon', 'evening'],
    );
    const missing = board.hours.find((h) => h.ictHour === 9)!;
    assert.equal(missing.present, false);
    assert.equal(missing.rainLabel, '—');
    assert.equal(missing.thunderLabel, '—');
    assert.equal(missing.uvLabel, '—');
    assert.equal(missing.windLabel, '—');
    assert.notEqual(board.blocks[0]?.tempLabel, '0°');
  });

  it('does not turn missing fields on a stored hour into zero', () => {
    const board = buildDailyBoard({
      dateYmd: DAY,
      hours: [
        hour(9, {
          rainChancePct: null,
          cloudCoverPct: null,
          capeJkg: null,
          uvIndex: null,
          windMs: null,
          tempC: null,
        }),
      ],
      bias: [],
      mode: 'live',
    });
    const row = board.hours.find((h) => h.ictHour === 9)!;
    assert.equal(row.present, true);
    assert.equal(row.rainChancePct, null);
    assert.equal(row.rainLabel, '—');
    assert.equal(row.thunderLabel, '—');
    assert.equal(row.uvLabel, '—');
    assert.equal(row.windLabel, '—');
    assert.equal(board.blocks[0]?.tempLabel, '—');
    assert.equal(board.blocks[0]?.sky, 'unavailable');
  });

  it('sends guests to the beach in the morning and a waterfall or market later', () => {
    const board = buildDailyBoard({
      dateYmd: DAY,
      hours: dayHours((h) => {
        if (h < 10) return { rainChancePct: 8, capeJkg: 200, cloudCoverPct: 15 };
        if (h < 14) return { rainChancePct: 18, capeJkg: 400 };
        return { rainChancePct: 62, capeJkg: 300, cloudCoverPct: 80 };
      }),
      bias: [],
      mode: 'live',
    });
    assert.equal(board.blocks.find((b) => b.id === 'morning')?.sky, 'sun');
    assert.equal(board.blocks.find((b) => b.id === 'afternoon')?.sky, 'shower');
    assert.match(board.bestForToday, /beach in the morning/i);
    assert.match(board.bestForToday, /waterfall or the market/i);
    assert.doesNotMatch(guestText(board), /\d+\s*mm|millimetre/i);
  });

  it('keeps the afternoon indoors when thunder risk is higher', () => {
    const board = buildDailyBoard({
      dateYmd: DAY,
      hours: dayHours((h) =>
        h >= 14 && h < 18
          ? { rainChancePct: 50, capeJkg: 1600 }
          : { rainChancePct: 10, capeJkg: 200 },
      ),
      bias: [],
      mode: 'live',
    });
    assert.equal(board.blocks.find((b) => b.id === 'afternoon')?.sky, 'thunder');
    assert.match(board.bestForToday, /indoors if thunder builds/i);
    assert.equal(bestForToday(board.blocks), board.bestForToday);
  });

  it('does not name a beach window when the forecast is missing', () => {
    const board = buildDailyBoard({
      dateYmd: DAY,
      hours: [],
      bias: [],
      mode: 'unavailable',
    });
    assert.match(board.bestForToday, /unavailable/i);
    assert.doesNotMatch(board.bestForToday, /beach/i);
    assert.ok(board.blocks.every((b) => b.tempLabel === '—' && b.rainChancePct == null));
    assert.match(board.biasSummary, /not enough recent garden hours/i);
  });

  it('uses a covered plan when showers are likely all day', () => {
    const board = buildDailyBoard({
      dateYmd: DAY,
      hours: dayHours(() => ({ rainChancePct: 70, capeJkg: 200, cloudCoverPct: 90 })),
      bias: [],
      mode: 'live',
    });
    assert.match(board.bestForToday, /covered plans/i);
    assert.doesNotMatch(board.bestForToday, /beach through/i);
  });
});

describe('sample board', () => {
  it('is labelled in the model and applies the sample afternoon correction', () => {
    const board = sampleDailyBoard(DAY);
    assert.equal(board.mode, 'sample');
    const afternoon = board.blocks.find((b) => b.id === 'afternoon')!;
    const morning = board.blocks.find((b) => b.id === 'morning')!;
    assert.equal(afternoon.adjusted, true);
    assert.equal(morning.adjusted, true);
    assert.ok(afternoon.tempLabel.includes('32') || afternoon.tempLabel.includes('31'));
    assert.match(board.bestForToday, /beach in the morning/i);
    assert.doesNotMatch(guestText(board), /\d+\s*mm|millimetre/i);
    const pairs = sampleTemperaturePairs(DAY);
    assert.ok(pairs.length >= BIAS_MIN_SAMPLES);
    assert.ok(GARDEN_STATION.x > 0 && GARDEN_STATION.x < MAP_W);
    assert.ok(GARDEN_STATION.y > 0 && GARDEN_STATION.y < MAP_H);
  });
});

describe('live load without credentials', () => {
  it('does not fill the board with invented numbers', async () => {
    assert.equal(process.env.SUPABASE_URL, undefined);
    const board = await loadDailyBoard({ dateYmd: DAY, now: new Date(`${DAY}T02:00:00.000Z`) });
    assert.equal(board.mode, 'unavailable');
    assert.ok(board.hours.every((h) => h.rainLabel === '—' && h.windLabel === '—'));
  });
});
