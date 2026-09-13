import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideScheduledRender,
  evaluateBroadcastLatest,
  shouldInsertHourlyBumper,
  vttTimestamp,
  type BroadcastEpisodePublic,
} from '../lib/broadcast-catalog';
import { slotForSchedule } from '../lib/broadcast-script';

const lower = {
  kicker: 'Sammi · Samui Weather',
  title: 'Koh Samui · Saturday, Sep 12',
  subtitle: 'High 28°C · Low 27°C · Beach day',
};

function ep(
  kind: 'feature' | 'hourly',
  publishedAt: string,
  delayed = false,
): BroadcastEpisodePublic {
  return {
    kind,
    slot: kind === 'feature' ? 'feature_0700' : 'hourly',
    url: kind === 'feature' ? '/broadcast/latest/feature.mp4' : '/broadcast/latest/hourly.mp4',
    captionsUrl: null,
    durationSec: kind === 'feature' ? 120 : 18,
    publishedAt,
    delayed,
    lowerThird: lower,
  };
}

describe('broadcast catalog freshness', () => {
  it('marks delayed when there is no feature', () => {
    const latest = evaluateBroadcastLatest({ feature: null, hourly: null }, Date.parse('2026-09-12T08:00:00+07:00'));
    assert.equal(latest.delayed, true);
    assert.equal(latest.featureIsToday, false);
  });

  it('treats a same-ICT-day feature as today', () => {
    const now = Date.parse('2026-09-12T15:30:00+07:00');
    const latest = evaluateBroadcastLatest(
      {
        feature: ep('feature', '2026-09-12T00:20:00.000Z'),
        hourly: ep('hourly', '2026-09-12T08:10:00.000Z'),
      },
      now,
    );
    assert.equal(latest.featureIsToday, true);
    assert.equal(latest.delayed, false);
    assert.equal(latest.hourlyIsFresh, true);
  });

  it('does not treat a stale hourly as fresh', () => {
    const now = Date.parse('2026-09-12T15:30:00+07:00');
    const latest = evaluateBroadcastLatest(
      {
        feature: ep('feature', '2026-09-12T00:20:00.000Z'),
        hourly: ep('hourly', '2026-09-12T06:00:00.000Z'),
      },
      now,
    );
    assert.equal(latest.hourlyIsFresh, false);
  });
});

describe('hourly bumper insert', () => {
  it('inserts at 08:00 ICT when the hourly file is fresh', () => {
    const now = Date.parse('2026-09-12T08:00:20+07:00');
    const latest = evaluateBroadcastLatest(
      {
        feature: ep('feature', '2026-09-12T00:20:00.000Z'),
        hourly: ep('hourly', '2026-09-12T01:00:00.000Z'),
      },
      now,
    );
    assert.equal(shouldInsertHourlyBumper(latest, now), true);
  });

  it('does not insert at a feature hour', () => {
    const now = Date.parse('2026-09-12T07:00:10+07:00');
    const latest = evaluateBroadcastLatest(
      {
        feature: ep('feature', '2026-09-12T00:20:00.000Z'),
        hourly: ep('hourly', '2026-09-12T00:05:00.000Z'),
      },
      now,
    );
    assert.equal(shouldInsertHourlyBumper(latest, now), false);
  });
});

describe('schedule clock', () => {
  it('skips overnight and picks feature vs hourly in ICT', () => {
    assert.equal(slotForSchedule(Date.parse('2026-09-12T03:00:00+07:00')), 'skip');
    assert.equal(slotForSchedule(Date.parse('2026-09-12T07:10:00+07:00')), 'feature_0700');
    assert.equal(slotForSchedule(Date.parse('2026-09-12T08:00:00+07:00')), 'hourly');
    assert.equal(slotForSchedule(Date.parse('2026-09-12T15:05:00+07:00')), 'feature_1500');
    assert.equal(slotForSchedule(Date.parse('2026-09-12T23:00:00+07:00')), 'skip');
  });

  it('keeps a good today feature when the new script is delayed', () => {
    const now = Date.parse('2026-09-12T15:05:00+07:00');
    const d = decideScheduledRender({
      now,
      scriptDelayed: true,
      latest: {
        feature: ep('feature', '2026-09-12T00:20:00.000Z', false),
        hourly: null,
      },
    });
    assert.equal(d.action, 'skip');
    assert.match(d.reason, /keep last good/);
  });

  it('still renders a delayed feature when there is no good episode today', () => {
    const now = Date.parse('2026-09-12T07:05:00+07:00');
    const d = decideScheduledRender({
      now,
      scriptDelayed: true,
      latest: { feature: null, hourly: null },
    });
    assert.equal(d.action, 'render');
    assert.equal(d.slot, 'feature_0700');
  });
});

describe('vtt timestamps', () => {
  it('formats act clocks', () => {
    assert.equal(vttTimestamp(0), '00:00:00.000');
    assert.equal(vttTimestamp(20), '00:00:20.000');
    assert.equal(vttTimestamp(120), '00:02:00.000');
  });
});
