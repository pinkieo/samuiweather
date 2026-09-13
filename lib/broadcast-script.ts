/**
 * Sammi Broadcast scripts — tourist TV copy from the Daily Vacation Brief.
 * Numbers and windows come from the brief; this file only sequences them for a slot.
 */

import {
  buildDailyVacationBrief,
  type DailyVacationBrief,
} from './daily-vacation-forecast';
import { getPoiById, type IslandPoi } from './island-pois';
import type { SammiDailyForecastViewRow } from './sammi-views';
import type { SamuiWeatherForecastRow } from './spire';

export const BROADCAST_TIME_ZONE = 'Asia/Bangkok';
export const FEATURE_ICT_HOURS = [7, 11, 15, 19] as const;
export type FeatureIctHour = (typeof FEATURE_ICT_HOURS)[number];

export type BroadcastSlot =
  | 'feature_0700'
  | 'feature_1100'
  | 'feature_1500'
  | 'feature_1900'
  | 'hourly';

export type BroadcastKind = 'feature' | 'hourly';
export type PresenterPose =
  | 'stand-left'
  | 'stand-right'
  | 'point-chaweng'
  | 'point-south'
  | 'hands-folded';

export type BroadcastFlyTo = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

export type BroadcastAct = {
  id: 'open' | 'beach' | 'rain' | 'evening' | 'close' | 'now';
  durationSec: number;
  pose: PresenterPose;
  flyTo: BroadcastFlyTo | null;
  lines: string[];
  caption: string;
};

export type BroadcastLowerThird = {
  kicker: string;
  title: string;
  subtitle: string;
};

export type BroadcastScript = {
  place: 'Koh Samui';
  kind: BroadcastKind;
  slot: BroadcastSlot;
  ictHour: number;
  dateLabel: string;
  verdict: DailyVacationBrief['verdict'];
  confidence: DailyVacationBrief['confidence'];
  delayed: boolean;
  lowerThird: BroadcastLowerThird;
  acts: BroadcastAct[];
  totalDurationSec: number;
  closeLine: string;
  sourceLine: string;
};

export type RadarEcho = 'unknown' | 'none' | 'precip';

const FEATURE_DURATION: Record<BroadcastAct['id'], number> = {
  open: 20,
  beach: 35,
  rain: 30,
  evening: 25,
  close: 10,
  now: 18,
};

function poiFly(id: string): BroadcastFlyTo | null {
  const poi: IslandPoi | undefined = getPoiById(id);
  if (!poi) return null;
  return { id: poi.id, name: poi.name, lat: poi.lat, lon: poi.lon };
}

export function isFeatureIctHour(hour: number): hour is FeatureIctHour {
  return (FEATURE_ICT_HOURS as readonly number[]).includes(hour);
}

export function shouldRenderHourlyBumper(hour: number): boolean {
  return hour >= 6 && hour <= 22 && !isFeatureIctHour(hour);
}

/** Which episode the LENOVOX13 hourly task should cut, or skip overnight. */
export function slotForSchedule(now: number = Date.now()): BroadcastSlot | 'skip' {
  const hour = localIctHour(now);
  if (hour < 6 || hour > 22) return 'skip';
  if (isFeatureIctHour(hour)) return featureSlotForHour(hour);
  return 'hourly';
}

export function featureSlotForHour(hour: FeatureIctHour): Exclude<BroadcastSlot, 'hourly'> {
  if (hour === 7) return 'feature_0700';
  if (hour === 11) return 'feature_1100';
  if (hour === 15) return 'feature_1500';
  return 'feature_1900';
}

export function parseBroadcastSlot(raw: string | null | undefined): BroadcastSlot | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'hourly' || s === 'hour') return 'hourly';
  if (s === '7' || s === '07' || s === '0700' || s === 'feature_0700') return 'feature_0700';
  if (s === '11' || s === '1100' || s === 'feature_1100') return 'feature_1100';
  if (s === '15' || s === '1500' || s === 'feature_1500') return 'feature_1500';
  if (s === '19' || s === '1900' || s === 'feature_1900') return 'feature_1900';
  return null;
}

export function localIctHour(now: number = Date.now()): number {
  const hourStr = new Date(now).toLocaleTimeString('en-US', {
    timeZone: BROADCAST_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  const h = parseInt(hourStr, 10);
  return Number.isFinite(h) ? h % 24 : 0;
}

function roundC(n: number | null): number | null {
  return n == null || !Number.isFinite(n) ? null : Math.round(n);
}

function highLowLine(brief: DailyVacationBrief): string {
  const hi = roundC(brief.temperature.max);
  const lo = roundC(brief.temperature.min);
  if (hi == null && lo == null) return 'Koh Samui';
  if (hi == null) return `Low ${lo}°C`;
  if (lo == null) return `High ${hi}°C`;
  return `High ${hi}°C · Low ${lo}°C`;
}

function verdictTagline(brief: DailyVacationBrief): string {
  if (brief.confidence !== 'ok') {
    return brief.confidence === 'stale'
      ? 'Show delayed · forecast too old'
      : 'Hourly coverage too thin for a beach clock';
  }
  switch (brief.verdict) {
    case 'Beach-first':
      return brief.windows.rain
        ? 'Beach day, later showers possible'
        : 'Beach day';
    case 'Flexible day':
      return 'Flexible day — pick your window';
    case 'Rain-aware day':
      return 'Rain-aware day — time the outdoors';
    case 'Indoor-first':
      return 'Indoor-first — covered plans win';
    default:
      return brief.verdict;
  }
}

function dateTitle(brief: DailyVacationBrief): string {
  return `Koh Samui · ${brief.dateLabel}`;
}

function act(
  id: BroadcastAct['id'],
  pose: PresenterPose,
  lines: string[],
  flyTo: BroadcastFlyTo | null = null,
): BroadcastAct {
  const durationSec = FEATURE_DURATION[id];
  return {
    id,
    durationSec,
    pose,
    flyTo,
    lines,
    caption: lines.join(' '),
  };
}

function beachLines(brief: DailyVacationBrief, slot: BroadcastSlot): string[] {
  if (brief.confidence !== 'ok') {
    return [
      'I will not name a beach clock until the hourly forecast is fresh enough.',
      'Use the live map for now, darling.',
    ];
  }
  if (brief.windows.beach) {
    const windowText = brief.windows.beach.text.replace(/^Best beach window:\s*/i, '');
    if (slot === 'feature_1100') {
      return [
        `The morning plan still holds: beach ${windowText}.`,
        'Choeng Mon and Chaweng first — that is the easy water.',
      ];
    }
    if (slot === 'feature_1500') {
      return [
        `If you have not had a swim yet, the remaining beach window is ${windowText}.`,
        'Do not push past that clock if thunder is on the board.',
      ];
    }
    return [
      `Best beach window: ${windowText}.`,
      'Start Choeng Mon or Chaweng — I will move the map there.',
    ];
  }
  return [
    'No clear beach window today.',
    'Pool, spa, or a covered beach club — skip a long unshaded lie-down.',
  ];
}

function rainLines(
  brief: DailyVacationBrief,
  radarEcho: RadarEcho,
  slot: BroadcastSlot,
): string[] {
  const radar =
    radarEcho === 'precip'
      ? 'Rain is on the map right now.'
      : radarEcho === 'none'
        ? 'Radar over the island is quiet.'
        : null;
  if (brief.confidence !== 'ok') {
    return [radar ?? 'Watch the live radar.', 'I will not invent a rain clock on a thin forecast.'];
  }
  const bits: string[] = [];
  if (radar) bits.push(radar);
  if (brief.windows.thunder) {
    bits.push(brief.windows.thunder.text);
  } else if (brief.windows.rain) {
    bits.push(brief.windows.rain.text);
  } else if (!radar) {
    bits.push('No named rain window on the hourly strip.');
  }
  if (slot === 'feature_1500' && (brief.windows.thunder || brief.windows.rain)) {
    bits.push('If you are still on the sand, pack up before that clock.');
  }
  if (brief.windows.rain || brief.windows.thunder) {
    bits.push('Covered backup: Ark Bar, Carnival, or Coco Tam’s.');
  }
  return bits.slice(0, 3);
}

function eveningLines(brief: DailyVacationBrief, slot: BroadcastSlot): string[] {
  if (brief.confidence !== 'ok') {
    return ['I will not call outdoor dinner until the hours fill in.'];
  }
  if (brief.windows.evening) {
    if (slot === 'feature_1900') {
      return [
        'Evening still works outdoors.',
        'Bophut and Fisherman’s Village — walk the strip, skip the south gate after half past six.',
      ];
    }
    return [
      'Evening looks good for an outdoor meal.',
      'Fisherman’s Village and Bophut are the play.',
    ];
  }
  return [
    'Outdoor dinner is a gamble tonight.',
    'Covered decks and hotel restaurants — keep the beach road as a last resort.',
  ];
}

function openLines(brief: DailyVacationBrief, slot: BroadcastSlot): string[] {
  const hi = roundC(brief.temperature.max);
  const lo = roundC(brief.temperature.min);
  const temp =
    hi != null && lo != null ? `High ${hi}, low ${lo}.` : hi != null ? `High ${hi}.` : '';
  if (brief.confidence !== 'ok') {
    return [
      slot === 'feature_0700' ? 'Good morning Koh Samui.' : 'Koh Samui update.',
      brief.confidence === 'stale'
        ? 'The satellite hours are too old for a tourist clock.'
        : 'Hourly coverage is too thin to name beach or dinner windows.',
    ];
  }
  const greeting =
    slot === 'feature_0700'
      ? 'Good morning Koh Samui.'
      : slot === 'feature_1900'
        ? 'Good evening Koh Samui.'
        : 'Koh Samui, here is the tourist clock.';
  return [greeting, `${temp} ${verdictTagline(brief)}`.trim()].filter(Boolean);
}

function closeLines(brief: DailyVacationBrief, slot: BroadcastSlot, tomorrow?: DailyVacationBrief | null): string[] {
  if (slot === 'feature_1900') {
    if (tomorrow && tomorrow.confidence === 'ok') {
      return [
        `Tomorrow leans ${tomorrow.verdict.toLowerCase()}.`,
        'I will be back on the hour. I am Sammi.',
      ];
    }
    return [
      'Tomorrow stays qualitative until the next hourly fill.',
      'I will be back on the hour. I am Sammi.',
    ];
  }
  if (brief.confidence !== 'ok') {
    return ['Watch the live map. I will be back on the hour.'];
  }
  return ['I will be back on the hour with a short update. I am Sammi.'];
}

function nextThreeHourAction(
  brief: DailyVacationBrief,
  ictHour: number,
  radarEcho: RadarEcho,
): string {
  if (brief.confidence !== 'ok') {
    return 'Use the live map — I will not name a window on a thin forecast.';
  }
  if (radarEcho === 'precip') {
    return 'Rain on the map now — covered cafes and malls for the next hour.';
  }
  const beach = brief.windows.beach;
  if (beach && ictHour < beach.endHourExclusive && ictHour + 3 >= beach.startHour) {
    return `Go Choeng Mon or Chaweng now — beach window until ${String(beach.endHourExclusive).padStart(2, '0')}:00.`;
  }
  const thunder = brief.windows.thunder;
  if (thunder && ictHour < thunder.endHourExclusive && thunder.startHour - ictHour <= 3) {
    return `Be under cover by ${String(thunder.startHour).padStart(2, '0')}:00 — thunder on the clock.`;
  }
  const rain = brief.windows.rain;
  if (rain && ictHour < rain.endHourExclusive && rain.startHour - ictHour <= 3) {
    return `Outdoors until ${String(rain.startHour).padStart(2, '0')}:00, then cover.`;
  }
  const evening = brief.windows.evening;
  if (evening && ictHour >= 17) {
    return 'Bophut and Fisherman’s Village still work for dinner.';
  }
  return 'Flexible next three hours — pick shade and a pool if the beach clock has closed.';
}

function nowTempLine(nowRow: SamuiWeatherForecastRow | null, radarEcho: RadarEcho): string {
  const temp = nowRow && Number.isFinite(nowRow.temp) ? `${Math.round(nowRow.temp)}°C` : null;
  const raining = radarEcho === 'precip' ? 'rain on the map' : 'no rain on the map';
  if (temp) return `Now ${temp}, ${raining}.`;
  return `Now: ${raining}.`;
}

function buildHourly(
  brief: DailyVacationBrief,
  ictHour: number,
  radarEcho: RadarEcho,
  nowRow: SamuiWeatherForecastRow | null,
): BroadcastScript {
  const delayed = brief.confidence !== 'ok';
  const lines = [
    nowTempLine(nowRow, radarEcho),
    nextThreeHourAction(brief, ictHour, radarEcho),
  ];
  const nowAct = act('now', 'stand-left', lines, poiFly('carnival_beach_club'));
  return {
    place: 'Koh Samui',
    kind: 'hourly',
    slot: 'hourly',
    ictHour,
    dateLabel: brief.dateLabel,
    verdict: brief.verdict,
    confidence: brief.confidence,
    delayed,
    lowerThird: {
      kicker: 'Sammi · Samui Weather',
      title: dateTitle(brief),
      subtitle: `${highLowLine(brief)} · ${verdictTagline(brief)}`,
    },
    acts: [nowAct],
    totalDurationSec: nowAct.durationSec,
    closeLine: delayed ? 'Live map until the hours fill in.' : 'I am Sammi — full show at 07:00, 11:00, 15:00 and 19:00.',
    sourceLine: brief.sourceLine,
  };
}

function buildFeature(
  brief: DailyVacationBrief,
  slot: Exclude<BroadcastSlot, 'hourly'>,
  ictHour: number,
  radarEcho: RadarEcho,
  tomorrow: DailyVacationBrief | null,
): BroadcastScript {
  const delayed = brief.confidence !== 'ok';
  const beachFly = poiFly('carnival_beach_club');
  const rainFly = poiFly('ark_bar');
  const eveningFly = poiFly('fishermans_village');
  const acts: BroadcastAct[] = [
    act('open', 'stand-left', openLines(brief, slot), beachFly),
    act('beach', 'point-chaweng', beachLines(brief, slot), beachFly),
    act('rain', delayed || brief.windows.rain || brief.windows.thunder ? 'point-south' : 'hands-folded', rainLines(brief, radarEcho, slot), rainFly),
    act('evening', 'stand-right', eveningLines(brief, slot), eveningFly),
    act('close', 'hands-folded', closeLines(brief, slot, tomorrow), eveningFly),
  ];
  return {
    place: 'Koh Samui',
    kind: 'feature',
    slot,
    ictHour,
    dateLabel: brief.dateLabel,
    verdict: brief.verdict,
    confidence: brief.confidence,
    delayed,
    lowerThird: {
      kicker: 'Sammi · Samui Weather',
      title: dateTitle(brief),
      subtitle: `${highLowLine(brief)} · ${verdictTagline(brief)}`,
    },
    acts,
    totalDurationSec: acts.reduce((n, a) => n + a.durationSec, 0),
    closeLine: acts[acts.length - 1]!.lines[acts[acts.length - 1]!.lines.length - 1] ?? '',
    sourceLine: brief.sourceLine,
  };
}

export function buildBroadcastScript(opts: {
  brief: DailyVacationBrief;
  slot: BroadcastSlot;
  ictHour?: number;
  radarEcho?: RadarEcho;
  nowRow?: SamuiWeatherForecastRow | null;
  tomorrowBrief?: DailyVacationBrief | null;
}): BroadcastScript {
  const radarEcho = opts.radarEcho ?? 'unknown';
  if (opts.slot === 'hourly') {
    const hour = opts.ictHour ?? 10;
    return buildHourly(opts.brief, hour, radarEcho, opts.nowRow ?? null);
  }
  const hour =
    opts.ictHour ??
    (opts.slot === 'feature_0700'
      ? 7
      : opts.slot === 'feature_1100'
        ? 11
        : opts.slot === 'feature_1500'
          ? 15
          : 19);
  return buildFeature(opts.brief, opts.slot, hour, radarEcho, opts.tomorrowBrief ?? null);
}

export function buildBroadcastScriptFromRows(
  rows: SamuiWeatherForecastRow[],
  opts: {
    slot: BroadcastSlot;
    now?: number;
    sammiDaily?: SammiDailyForecastViewRow | null;
    radarEcho?: RadarEcho;
    tomorrowRows?: SamuiWeatherForecastRow[] | null;
  },
): BroadcastScript {
  const now = opts.now ?? Date.now();
  const brief = buildDailyVacationBrief(rows, {
    now,
    sammiDaily: opts.sammiDaily ?? null,
  });
  let tomorrowBrief: DailyVacationBrief | null = null;
  if (opts.slot === 'feature_1900' && opts.tomorrowRows && opts.tomorrowRows.length > 0) {
    const tomorrowNow = now + 24 * 60 * 60 * 1000;
    tomorrowBrief = buildDailyVacationBrief(opts.tomorrowRows, { now: tomorrowNow });
  }
  const nowRow = rows[0] ?? null;
  return buildBroadcastScript({
    brief,
    slot: opts.slot,
    radarEcho: opts.radarEcho,
    nowRow,
    tomorrowBrief,
  });
}
