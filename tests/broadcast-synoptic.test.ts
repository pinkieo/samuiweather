import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inferSynopticStory, isEasterlyFeed, meanWindDirDeg } from '../lib/broadcast-synoptic';

describe('synoptic story', () => {
  it('names a Vietnam low only on easterly flow plus rain', () => {
    const wetEast = inferSynopticStory({ windDirDeg: 90, hasRainOrThunder: true });
    assert.equal(wetEast.mentionVietnamLow, true);
    assert.match(wetEast.line ?? '', /Vietnam/);
    const dryEast = inferSynopticStory({ windDirDeg: 90, hasRainOrThunder: false });
    assert.equal(dryEast.mentionVietnamLow, false);
    assert.ok(!/feeding moisture/i.test(dryEast.line ?? ''));
    const wetWest = inferSynopticStory({ windDirDeg: 250, hasRainOrThunder: true });
    assert.equal(wetWest.mentionVietnamLow, false);
  });

  it('treats 45–135 as easterly Gulf feed', () => {
    assert.equal(isEasterlyFeed(90), true);
    assert.equal(isEasterlyFeed(20), false);
    assert.equal(meanWindDirDeg([{ windDir: 90 }, { windDir: 90 }]), 90);
  });
});
