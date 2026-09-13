/**
 * Latest Sammi Broadcast episodes for the website player.
 * Manifest is written by scripts/broadcast-render.ts into public/broadcast/latest/.
 */

import {
  BROADCAST_TIME_ZONE,
  isFeatureIctHour,
  localIctHour,
  shouldRenderHourlyBumper,
  slotForSchedule,
  type BroadcastKind,
  type BroadcastLowerThird,
  type BroadcastScript,
  type BroadcastSlot,
} from './broadcast-script';

export const HOURLY_STALE_AFTER_MS = 90 * 60 * 1000;
/** Skip a second cut in the same hour (same idea as weather ingest SKIP_IF_FRESH_MINUTES). */
export const SCHEDULE_SKIP_IF_FRESH_MS = 50 * 60 * 1000;

export type ScheduleDecision = {
  action: 'render' | 'skip';
  reason: string;
  slot: BroadcastSlot | 'skip';
};

export function decideScheduledRender(opts: {
  now?: number;
  force?: boolean;
  scriptDelayed?: boolean | null;
  latest: BroadcastManifest | null;
}): ScheduleDecision {
  const now = opts.now ?? Date.now();
  const slot = slotForSchedule(now);
  if (slot === 'skip') {
    return { action: 'skip', reason: 'outside 06:00–22:00 ICT', slot };
  }
  if (opts.force) {
    return { action: 'render', reason: 'forced', slot };
  }

  const latest = opts.latest;
  if (slot === 'hourly') {
    const pub = latest?.hourly?.publishedAt;
    const age = pub ? now - Date.parse(pub) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(age) && age < SCHEDULE_SKIP_IF_FRESH_MS) {
      return { action: 'skip', reason: 'hourly still fresh', slot };
    }
  } else {
    const feat = latest?.feature ?? null;
    if (
      feat &&
      feat.slot === slot &&
      Number.isFinite(Date.parse(feat.publishedAt)) &&
      now - Date.parse(feat.publishedAt) < SCHEDULE_SKIP_IF_FRESH_MS
    ) {
      return { action: 'skip', reason: 'this feature slot already rendered', slot };
    }
    if (opts.scriptDelayed && feat && !feat.delayed && episodeIctDate(feat.publishedAt) === ictDateKey(now)) {
      return { action: 'skip', reason: 'keep last good feature; forecast delayed', slot };
    }
  }

  return { action: 'render', reason: slot === 'hourly' ? 'hourly due' : 'feature due', slot };
}

export type BroadcastEpisodePublic = {
  kind: BroadcastKind;
  slot: BroadcastSlot;
  url: string;
  captionsUrl: string | null;
  durationSec: number;
  publishedAt: string;
  delayed: boolean;
  lowerThird: BroadcastLowerThird;
};

export type BroadcastManifest = {
  feature: BroadcastEpisodePublic | null;
  hourly: BroadcastEpisodePublic | null;
};

export type BroadcastLatest = BroadcastManifest & {
  delayed: boolean;
  reason: string | null;
  featureIsToday: boolean;
  hourlyIsFresh: boolean;
};

export function ictDateKey(now: number = Date.now()): string {
  return new Date(now).toLocaleDateString('en-CA', {
    timeZone: BROADCAST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function ictMinute(now: number = Date.now()): number {
  const s = new Date(now).toLocaleTimeString('en-US', {
    timeZone: BROADCAST_TIME_ZONE,
    minute: '2-digit',
    hour12: false,
  });
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

export function episodeIctDate(publishedAt: string): string | null {
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return null;
  return ictDateKey(t);
}

export function evaluateBroadcastLatest(
  manifest: BroadcastManifest | null | undefined,
  now: number = Date.now(),
): BroadcastLatest {
  const feature = manifest?.feature ?? null;
  const hourly = manifest?.hourly ?? null;
  const featureIsToday = Boolean(feature && episodeIctDate(feature.publishedAt) === ictDateKey(now));
  const hourlyAge = hourly ? now - Date.parse(hourly.publishedAt) : Number.POSITIVE_INFINITY;
  const hourlyIsFresh = Boolean(hourly && Number.isFinite(hourlyAge) && hourlyAge <= HOURLY_STALE_AFTER_MS);

  let delayed = false;
  let reason: string | null = null;
  if (!feature) {
    delayed = true;
    reason = 'No feature episode yet.';
  } else if (!featureIsToday) {
    delayed = true;
    reason = 'Today’s feature is not on air yet.';
  } else if (feature.delayed) {
    delayed = true;
    reason = 'Feature recorded with a thin or stale forecast.';
  }

  return {
    feature,
    hourly,
    delayed,
    reason,
    featureIsToday,
    hourlyIsFresh,
  };
}

/** Play the hourly bumper once at the top of a non-feature ICT hour, if it is fresh. */
export function shouldInsertHourlyBumper(
  latest: BroadcastLatest,
  now: number = Date.now(),
): boolean {
  if (!latest.hourly || !latest.hourlyIsFresh) return false;
  const hour = localIctHour(now);
  if (!shouldRenderHourlyBumper(hour) || isFeatureIctHour(hour)) return false;
  return ictMinute(now) === 0;
}

export function vttTimestamp(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const whole = Math.floor(sec);
  const ms = Math.round((sec - whole) * 1000);
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(whole, 2)}.${pad(ms, 3)}`;
}

export function scriptToVtt(script: BroadcastScript): string {
  let t = 0;
  const cues: string[] = [];
  for (const act of script.acts) {
    const start = t;
    t += act.durationSec;
    cues.push(`${vttTimestamp(start)} --> ${vttTimestamp(t)}\n${act.caption}`);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export function episodeFromScript(
  script: BroadcastScript,
  opts: { url: string; captionsUrl: string | null; publishedAt: string },
): BroadcastEpisodePublic {
  return {
    kind: script.kind,
    slot: script.slot,
    url: opts.url,
    captionsUrl: opts.captionsUrl,
    durationSec: script.totalDurationSec,
    publishedAt: opts.publishedAt,
    delayed: script.delayed,
    lowerThird: script.lowerThird,
  };
}
