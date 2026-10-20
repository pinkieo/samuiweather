import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDailyBoard, formatIssuedLabel, type BoardHourInput } from '../lib/daily-board';
import { fillMissingUv, openMeteoUvHourMap, uvSourceNote } from '../lib/daily-board-uv';
import { forecastRowToHour } from '../lib/daily-board-load';

const DAY = '2026-10-20';
const at = (h: number) => new Date(`${DAY}T${String(h).padStart(2, '0')}:00:00+07:00`).toISOString();
// Real Open-Meteo shape (timezone=GMT), values from 20 Oct 2026 for Koh Samui.
const UV_UTC = [0.4, 2.1, 4.9, 8.3, 10.8, 11.8, 10.6, 7.8, 4.5, 1.7, 0.3, 0];
const openMeteoPayload = {
  hourly: {
    time: UV_UTC.map((_, i) => `2026-10-20T${String(i).padStart(2, '0')}:00`).concat('2026-10-20T12:00'),
    uv_index: [...UV_UTC, null],
  },
};

function hour(h: number, uv: number | null): BoardHourInput {
  return { timeUtc: at(h), tempC: 30, rainChancePct: 10, cloudCoverPct: 20, capeJkg: 100, windMs: 3, uvIndex: uv };
}

describe('Open-Meteo UV fallback', () => {
  it('parses GMT hours and skips nulls', () => {
    const map = openMeteoUvHourMap(openMeteoPayload);
    assert.equal(map.get(Date.parse('2026-10-20T05:00:00Z')), 11.8);
    assert.equal(map.has(Date.parse('2026-10-20T12:00:00Z')), false);
    assert.equal(openMeteoUvHourMap({}).size, 0);
  });

  it('fills only null hours, keeps stored UV, never invents zeros', () => {
    const map = openMeteoUvHourMap(openMeteoPayload);
    const out = fillMissingUv(
      [
        { ...hour(12, 9), uvSource: 'openuv' as const },
        hour(13, null),
        hour(20, null), // 13:00 UTC, absent from Open-Meteo
      ],
      map,
    );
    assert.deepEqual(out.map((h) => [h.uvIndex, h.uvSource ?? null]), [
      [9, 'openuv'],
      [10.6, 'open-meteo'],
      [null, null],
    ]);
    assert.equal(fillMissingUv([hour(13, null)], null)[0].uvIndex, null);
  });

  it('renders a UV value per block peaking at midday when stored UV is all null', () => {
    const stored = [];
    for (let h = 6; h < 22; h++) stored.push(hour(h, null));
    const hours = fillMissingUv(stored, openMeteoUvHourMap(openMeteoPayload));
    const board = buildDailyBoard({ dateYmd: DAY, hours, bias: [], mode: 'live' });
    const uvBlocks = board.blocks.map((b) => [b.id, b.uvMax]);
    const midday = board.blocks.find((b) => b.id === 'midday');
    assert.ok(midday && midday.uvMax === 11.8, JSON.stringify(uvBlocks));
    for (const b of board.blocks) if (b.id !== 'evening') assert.ok(b.uvMax != null, JSON.stringify(uvBlocks));
    assert.equal(board.hours.find((h) => h.ictHour === 12)?.uvLabel, '12 extreme');
    assert.equal(board.uvNote, 'UV index: Open-Meteo forecast.');
  });

  it('names mixed sources and returns null when there is no UV', () => {
    assert.equal(uvSourceNote(['openuv', 'open-meteo', 'openuv']), 'UV index: OpenUV + Open-Meteo forecast.');
    assert.equal(uvSourceNote([null, undefined]), null);
  });

  it('reads stored source from values_json', () => {
    const base = { valid_time_utc: at(12), issuance_time_utc: null, air_temperature_c: 30, wind_speed_ms: 3,
      total_cloud_cover: 20, cape: 0, probability_of_precipitation_1hr: 10 };
    assert.equal(forecastRowToHour({ ...base, uv_index: 11.8, values_json: { uv_index_source: 'openuv' } }).uvSource, 'openuv');
    assert.equal(forecastRowToHour({ ...base, uv_index: 5, values_json: {} }).uvSource, 'spire');
    assert.equal(forecastRowToHour({ ...base, uv_index: null, values_json: {} }).uvSource, null);
  });
});

describe('issued label', () => {
  it('shows the run time in ICT, with the date when the run is from another day', () => {
    assert.equal(formatIssuedLabel('2026-10-20T00:00:00+00:00', '2026-10-20'), 'Issued 07:00 ICT');
    assert.equal(formatIssuedLabel('2026-10-19T12:00:00+00:00', '2026-10-20'), 'Issued Mon 19 Oct, 19:00 ICT');
    assert.equal(formatIssuedLabel('2026-10-19T00:00:00+00:00', '2026-10-20'), 'Issued Mon 19 Oct, 07:00 ICT');
    assert.equal(formatIssuedLabel('2026-10-19T22:00:00Z', '2026-10-20'), 'Issued 05:00 ICT');
    assert.equal(formatIssuedLabel(null, DAY), null);
  });
});
