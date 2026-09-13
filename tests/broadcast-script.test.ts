import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBroadcastScript,
  buildBroadcastScriptFromRows,
  featureSlotForHour,
  isFeatureIctHour,
  parseBroadcastSlot,
  shouldRenderHourlyBumper,
} from '../lib/broadcast-script';
import { buildDailyVacationBrief } from '../lib/daily-vacation-forecast';
import type { SamuiWeatherForecastRow } from '../lib/spire';

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

describe('broadcast slots', () => {
  it('treats 07/11/15/19 ICT as features and other 06–22 hours as bumpers', () => {
    assert.equal(isFeatureIctHour(7), true);
    assert.equal(featureSlotForHour(7), 'feature_0700');
    assert.equal(featureSlotForHour(19), 'feature_1900');
    assert.equal(shouldRenderHourlyBumper(7), false);
    assert.equal(shouldRenderHourlyBumper(8), true);
    assert.equal(shouldRenderHourlyBumper(5), false);
    assert.equal(parseBroadcastSlot('7'), 'feature_0700');
    assert.equal(parseBroadcastSlot('hourly'), 'hourly');
    assert.equal(parseBroadcastSlot('nope'), null);
  });
});

describe('feature on a dry sunny day', () => {
  const rows = dayHours(6, 22, (hour) => ({
    temp: hour >= 12 && hour <= 14 ? 32.4 : 29.5,
    pop: 10,
    precipRate: 0,
    windSpeed: 3,
  }));

  it('builds a ~2 minute tourist show with beach and dinner, no invented rain', () => {
    const script = buildBroadcastScriptFromRows(rows, {
      slot: 'feature_0700',
      now: NOW,
      radarEcho: 'none',
    });
    assert.equal(script.kind, 'feature');
    assert.equal(script.delayed, false);
    assert.equal(script.place, 'Koh Samui');
    assert.equal(script.totalDurationSec, 120);
    assert.equal(script.acts.map((a) => a.id).join(','), 'open,beach,rain,evening,close');
    assert.match(script.lowerThird.kicker, /Sammi/);
    assert.match(script.lowerThird.subtitle, /High 32°C/);
    assert.match(script.lowerThird.subtitle, /Low 30°C/);
    const beach = script.acts.find((a) => a.id === 'beach')!;
    assert.match(beach.caption, /Best beach window:/);
    assert.equal(beach.flyTo?.id, 'carnival_beach_club');
    const rain = script.acts.find((a) => a.id === 'rain')!;
    assert.match(rain.caption, /quiet|No named rain/i);
    const evening = script.acts.find((a) => a.id === 'evening')!;
    assert.match(evening.caption, /Fisherman/);
    assert.ok(!script.acts.some((a) => /OpenWeather|Spire OPF|model/i.test(a.caption)));
  });
});

describe('afternoon rain day', () => {
  const rows = dayHours(6, 22, (hour) => {
    if (hour >= 15 && hour < 19) {
      return { pop: 62, precipRate: 0.9, precip: 0.9, cloudCover: 80 };
    }
    return { pop: 12, precipRate: 0, cloudCover: 20 };
  });

  it('keeps the morning beach clock and tells tourists to pack up before 15:00', () => {
    const script = buildBroadcastScriptFromRows(rows, {
      slot: 'feature_1500',
      now: NOW,
      radarEcho: 'precip',
    });
    assert.equal(script.delayed, false);
    assert.match(script.acts.find((a) => a.id === 'beach')!.caption, /window/i);
    assert.match(script.acts.find((a) => a.id === 'rain')!.caption, /Rain is on the map/);
    assert.match(script.acts.find((a) => a.id === 'rain')!.caption, /15:00/);
  });
});

describe('all-day rain', () => {
  const rows = dayHours(6, 22, {
    pop: 72,
    precipRate: 1.3,
    precip: 1.2,
    cloudCover: 90,
  });

  it('does not name a beach or outdoor dinner window', () => {
    const script = buildBroadcastScriptFromRows(rows, { slot: 'feature_0700', now: NOW });
    assert.match(script.acts.find((a) => a.id === 'beach')!.caption, /No clear beach window/);
    assert.ok(!script.acts.some((a) => /Best beach window/i.test(a.caption)));
    assert.ok(!script.acts.some((a) => /Evening looks good for an outdoor meal/i.test(a.caption)));
  });
});

describe('stale forecast', () => {
  const rows = dayHours(6, 22, { pop: 8, precipRate: 0 });

  it('marks the show delayed and withholds beach and dinner clocks', () => {
    const fresh = buildBroadcastScriptFromRows(rows, { slot: 'feature_0700', now: NOW });
    assert.equal(fresh.delayed, false);
    const brief = buildDailyVacationBrief(rows, {
      now: NOW,
      freshness: { stale: true, ageMinutes: 180, label: '3h ago' },
    });
    const script = buildBroadcastScript({
      brief,
      slot: 'feature_0700',
      radarEcho: 'none',
    });
    assert.equal(script.delayed, true);
    assert.match(script.lowerThird.subtitle, /delayed|too old/i);
    assert.ok(!script.acts.some((a) => /Best beach window/i.test(a.caption)));
    assert.match(script.acts.find((a) => a.id === 'beach')!.caption, /will not name a beach clock/i);
  });
});

describe('hourly bumper', () => {
  const rows = dayHours(6, 22, { pop: 10, precipRate: 0, temp: 29.2 });

  it('is 15–20s, one act, and names a next-three-hour tourist action', () => {
    const script = buildBroadcastScriptFromRows(rows, {
      slot: 'hourly',
      now: NOW,
      radarEcho: 'none',
    });
    assert.equal(script.kind, 'hourly');
    assert.equal(script.acts.length, 1);
    assert.equal(script.acts[0]!.id, 'now');
    assert.ok(script.totalDurationSec >= 15 && script.totalDurationSec <= 20);
    assert.match(script.acts[0]!.caption, /Now 29°C/);
    assert.match(script.acts[0]!.caption, /Choeng Mon|Chaweng|Flexible/);
  });
});
