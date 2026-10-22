import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOARD_LIVE_REFRESH_MS, formatIssuedLabel } from '../lib/daily-board';
import { boardHourFromForecastRow, loadDailyBoard } from '../lib/daily-board-load';
import { newestIssuanceTimeUtc, withLatestHourlyRun } from '../lib/spire';
import { ingestScheduleMatches } from '../lib/weather-cron-schedule';

const NOW = new Date('2026-10-21T02:30:00.000Z');

describe('live board feed', () => {
  it('keeps the newest Spire issuance and does not rescale a percent', () => {
    const issued = newestIssuanceTimeUtc([
      { times: { issuance_time: '2026-10-20T00:00:00+00:00' } },
      { times: { issuance_time: '2026-10-20T12:00:00+00:00' } },
    ]);
    assert.equal(issued, '2026-10-20T12:00:00.000Z');
    const hour = boardHourFromForecastRow({
      time: '2026-10-21T05:00:00.000Z',
      temp: 28.4,
      pop: 17,
      cloudCover: 48,
      cape: 900,
      windSpeed: 2,
      uvIndex: 11.6,
    });
    assert.equal(hour.rainChancePct, 17);
    assert.equal(hour.uvIndex, 11.6);
    assert.equal(hour.uvSource, 'openuv');
    assert.equal(hour.cloudCoverPct, 48);
  });

  it('draws today from the live run instead of an empty store', async () => {
    let calls = 0;
    const board = await loadDailyBoard({
      now: NOW,
      dateYmd: '2026-10-21',
      loadFeed: async () => {
        calls += 1;
        return {
          issuedAtUtc: '2026-10-20T12:00:00.000Z',
          hours: [
            {
              timeUtc: '2026-10-21T05:00:00.000Z',
              tempC: 28.4,
              rainChancePct: 17,
              cloudCoverPct: 40,
              capeJkg: 200,
              windMs: 2,
              uvIndex: 11.6,
              uvSource: 'openuv',
            },
          ],
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(board.mode, 'live');
    assert.equal(board.issuedLabel, 'Issued Tue 20 Oct, 19:00 ICT');
    const noon = board.hours.find((h) => h.ictHour === 12);
    assert.equal(noon?.rainLabel, '17%');
    assert.equal(noon?.uvLabel, '12 extreme');
    assert.match(board.uvNote ?? '', /OpenUV/);
  });

  it('does not ask the live feed for a past day', async () => {
    let calls = 0;
    const board = await loadDailyBoard({
      now: NOW,
      dateYmd: '2026-10-17',
      loadFeed: async () => {
        calls += 1;
        return { hours: [], issuedAtUtc: '2026-10-20T12:00:00.000Z' };
      },
    });
    assert.equal(calls, 0);
    assert.equal(board.mode, 'unavailable');
  });

  it('refreshes an open live board every five minutes', () => {
    assert.equal(BOARD_LIVE_REFRESH_MS, 5 * 60 * 1000);
  });
});

describe('issued label at 05:50 ICT', () => {
  it('uses the hourly Spire run, not the older 15-day cycle', () => {
    // 05:50 ICT on 22 Oct 2026. The 15-day bundle is still the 00:00Z cycle
    // (Wed 21 Oct, 07:00 ICT). The hourly product has already moved to 12:00Z.
    const combined = Array.from({ length: 40 }, (_, index) => ({
      times: {
        issuance_time: '2026-10-21T00:00:00+00:00',
        valid_time: new Date(Date.UTC(2026, 9, 21, 0, 0, 0) + index * 6 * 3_600_000).toISOString(),
      },
      values: { air_temperature: 300 },
    }));
    const hourly = Array.from({ length: 48 }, (_, index) => ({
      times: {
        issuance_time: '2026-10-21T12:00:00+00:00',
        valid_time: new Date(Date.UTC(2026, 9, 21, 12, 0, 0) + index * 3_600_000).toISOString(),
      },
      values: { air_temperature: 301 },
    }));
    const rows = withLatestHourlyRun(combined, hourly);
    const issued = newestIssuanceTimeUtc(rows);
    assert.equal(formatIssuedLabel(issued, '2026-10-22'), 'Issued Wed 21 Oct, 19:00 ICT');
    const noon = rows.find((row) => {
      const valid = (row as { times?: { valid_time?: string } }).times?.valid_time;
      return valid != null && new Date(valid).toISOString() === '2026-10-22T05:00:00.000Z';
    }) as { values?: { air_temperature?: number } } | undefined;
    assert.equal(noon?.values?.air_temperature, 301);
  });

  it('leaves a newer combined bundle in place', () => {
    const combined = [
      {
        times: { issuance_time: '2026-10-21T18:00:00Z', valid_time: '2026-10-22T00:00:00Z' },
        values: { air_temperature: 1 },
      },
    ];
    const hourly = [
      {
        times: { issuance_time: '2026-10-21T12:00:00Z', valid_time: '2026-10-22T00:00:00Z' },
        values: { air_temperature: 2 },
      },
    ];
    const rows = withLatestHourlyRun(combined, hourly);
    assert.equal(rows.length, 1);
    assert.equal((rows[0] as { values?: { air_temperature?: number } }).values?.air_temperature, 1);
  });
});

describe('ingest clock', () => {
  it('rejects a job that only fires at midnight and noon', () => {
    assert.equal(
      ingestScheduleMatches({ timezone: 'Asia/Bangkok', hours: [0, 12], minutes: [5] }),
      false,
    );
    assert.equal(
      ingestScheduleMatches({ timezone: 'UTC', hours: [0, 6, 12, 18], minutes: [5] }),
      false,
    );
    assert.equal(
      ingestScheduleMatches({ timezone: 'Asia/Bangkok', hours: [18, 0, 12, 6], minutes: [5] }),
      true,
    );
    assert.equal(
      ingestScheduleMatches({ timezone: 'Asia/Bangkok', hours: [0, 6, 12, 18], minutes: [10] }, 10),
      true,
    );
  });
});
