'use client';

import React, { useState } from 'react';
import { formatTempC, formatWindMs, type SamuiWeatherForecastRow } from '../lib/spire';
import { getSunInfo } from '../lib/sun';
import type { SammiDailyForecastViewRow } from '../lib/sammi-views';
import { HourlyScrollStrip, HourlyStripForCalendarDay } from './HourlyForecast';

/** Cap daily strip at 15 calendar days (matches ~360h Spire target when available). */
const MAX_DAILY_OUTLOOK = 15;

const TZ = 'Asia/Bangkok';

/** “Next few hours” — 7h forward from *now* (center of 6–8h) + 1h lookback to include the current model hour. */
const NEAR_FUTURE_HOURS_MS = 7 * 60 * 60 * 1000;
const NEAR_PAST_HOUR_MS = 1 * 60 * 60 * 1000;
/** “Later in the day” = first significant slot at or after 15:00 local. */
const LATE_SHOWERS_START_HOUR = 15;
const SIG_PRECIP_RATE = 0.5;
const SIG_POP = 30;
const THUNDER_CAPE_JKG = 1000;
/** Min POP% to show on the card (tourism-friendly — avoids “10%” noise). */
const MIN_CHANCE_TO_SHOW = 15;

export type TodayMood = 'storm' | 'rain' | 'beach' | 'mixed' | 'unsettled';
export type TodayReliability = 'high' | 'medium' | 'trend';

/**
 * All fields needed to render the calendar “Today” card with mood styling and tourist-friendly copy.
 */
export interface TodayCardInsight {
  today_icon: string;
  today_advice: string;
  /**
   * When the “story” of the day applies — under the main advice. Examples: “within the next
   * 2-3 hours”, “this afternoon (after 15:00)”, “tonight” (see `buildTimeHint*()` helpers).
   */
  time_hint: string;
  mood: TodayMood;
  /**
   * ~48h: high, mixed/later: medium, broad patterns / generic: trend (see `reliabilityLabel`).
   * Controls subtle ring/glow: high → stronger focus ring.
   */
  reliability: TodayReliability;
  /** 0 = suppress badge; 16+ → show (same scale as `pop` / derived POP). */
  chance_of_rain_pct: number;
}

interface DailyForecastProps {
  rows: SamuiWeatherForecastRow[];
  onDayClick?: (spireIndex: number) => void;
  /** Bangkok `YYYY-MM-DD` → daily Sammi (advice, reliability, kans_*). */
  sammiDailyByIsoDay?: Record<string, SammiDailyForecastViewRow> | null;
}

export interface DailyData {
  dateStr: string;
  dayName: string;
  minTemp: number;
  maxTemp: number;
  maxPop: number;
  maxPrecipRate: number;
  maxWindSpeed: number;
  maxWindGust: number;
  avgCloudCover: number;
  hoursCount: number;
  noonIndex: number;
  /** Bangkok-today only — replaces legacy max-precip copy when set. */
  today_insight?: TodayCardInsight;
}

function bangkokDateKey(d: Date): string {
  return d.toLocaleDateString('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function dateKeyForRow(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function effectivePop(row: SamuiWeatherForecastRow): number {
  let p = row.pop;
  if (!p && row.precipRate > 0) {
    p = Math.min(100, Math.round(row.precipRate * 20) + 20);
  }
  return p;
}

function hourInBangkok(iso: string): number {
  return parseInt(
    new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', hour12: false, timeZone: TZ }),
    10,
  );
}

/** English 12h time for the first shower slot (tourism copy). */
function formatTimeBangkokEn(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: TZ,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function maxEffectivePop(rows: SamuiWeatherForecastRow[]): number {
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((r) => effectivePop(r)));
}

function isSignificantHour(row: SamuiWeatherForecastRow): boolean {
  return row.precipRate > SIG_PRECIP_RATE || effectivePop(row) > SIG_POP;
}

function isThunderyHour(row: SamuiWeatherForecastRow): boolean {
  return row.cape != null && Number.isFinite(row.cape) && row.cape >= THUNDER_CAPE_JKG;
}

function isSignificantNearTerm(row: SamuiWeatherForecastRow): boolean {
  if (isSignificantHour(row)) return true;
  if (isThunderyHour(row) && (row.precipRate > 0.08 || effectivePop(row) >= 20)) {
    return true;
  }
  return false;
}

/**
 * Dry “beach day” branch: confidence from max POP in remaining hours (still no wet slots by our rules).
 * Low background POP → high; a single moderate blip in the day → medium.
 */
function pickBeachReliability(maxRestOfDayPop: number): TodayReliability {
  if (maxRestOfDayPop <= 25) return 'high';
  return 'medium';
}

/** Badge copy (short) + `title` tooltip; wording matches the three reliability bands. */
function reliabilityLabel(r: TodayReliability): { short: string; full: string } {
  switch (r) {
    case 'high':
      return {
        short: 'High confidence today',
        full: 'Short-range model run — use next hours with highest confidence',
      };
    case 'medium':
      return {
        short: 'Moderate confidence',
        full: 'Timing or intensity may shift — check the hourly strip',
      };
    case 'trend':
      return {
        short: 'Longer range trend',
        full: 'Broad pattern only — use hourly for exact times',
      };
  }
}

/**
 * Earliest wet slot in the near window → colloquial “window” for tourists in English.
 */
function buildTimeHintNearRain(
  nearWindowRows: SamuiWeatherForecastRow[],
  tNow: number,
): string {
  if (nearWindowRows.length === 0) return 'within the next few hours';
  const times = nearWindowRows.map((r) => new Date(r.time).getTime());
  const earliestT = Math.min(...times);
  const hours = (earliestT - tNow) / (60 * 60 * 1000);
  if (hours <= 3) return 'within the next 2-3 hours';
  return 'within the next few hours';
}

/**
 * First significant event after 15:00 local, not in the 7h near window.
 */
function buildTimeHintLaterToday(firstSigHourBangkok: number): string {
  if (firstSigHourBangkok < 17) {
    return 'this afternoon (after 15:00)';
  }
  if (firstSigHourBangkok < 20) {
    return 'late afternoon / early evening';
  }
  return 'tonight';
}

/**
 * @see TodayCardInsight — builds tourist-facing copy + fields for the Daily “Today” card.
 */
/**
 * Today card from `sammi_daily_forecast` (English copy + SQL reliability).
 */
function buildTodayCardInsightFromSammiDaily(
  d: SammiDailyForecastViewRow,
): TodayCardInsight {
  const rRain =
    d.kans_regen_pct_sammi != null && Number.isFinite(Number(d.kans_regen_pct_sammi))
      ? Number(d.kans_regen_pct_sammi)
      : 0;
  const rThunder =
    d.kans_onweer_pct_sammi != null && Number.isFinite(Number(d.kans_onweer_pct_sammi))
      ? Number(d.kans_onweer_pct_sammi)
      : 0;
  const sqlRel = d.reliability;
  const reliability: TodayReliability =
    sqlRel === 'low' ? 'trend' : sqlRel === 'medium' ? 'medium' : 'high';

  let mood: TodayMood = 'beach';
  let today_icon = '☀️';
  if (rThunder >= 30) {
    mood = 'storm';
    today_icon = '⛈️';
  } else if (rRain >= 50) {
    mood = 'rain';
    today_icon = '🌧️';
  } else if (rRain >= 25 || rThunder >= 15) {
    mood = rRain > 40 ? 'unsettled' : 'mixed';
    today_icon = '🌦️';
  }

  return {
    today_icon,
    today_advice: d.sammi_advice?.trim() || 'See hourly for timing.',
    time_hint: 'All day (Sammi daily summary)',
    mood,
    reliability,
    chance_of_rain_pct: rRain >= MIN_CHANCE_TO_SHOW ? Math.round(rRain) : 0,
  };
}

export function buildTodayCardInsightForRows(
  allRows: SamuiWeatherForecastRow[],
  now: Date = new Date(),
): TodayCardInsight | null {
  const todayKey = bangkokDateKey(now);
  const todayRows = allRows
    .filter((r) => dateKeyForRow(r.time) === todayKey)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  if (todayRows.length === 0) return null;

  const tNow = now.getTime();
  const nearStart = tNow - NEAR_PAST_HOUR_MS;
  const nearEnd = tNow + NEAR_FUTURE_HOURS_MS;

  const futureOnly = todayRows.filter((r) => new Date(r.time).getTime() >= tNow - 30 * 60 * 1000);
  const maxRestOfDayPop = maxEffectivePop(futureOnly);

  const nearWindowRows = todayRows.filter((r) => {
    const t = new Date(r.time).getTime();
    if (t < nearStart || t > nearEnd) return false;
    return isSignificantNearTerm(r);
  });
  const nearMaxPop = maxEffectivePop(nearWindowRows);

  if (nearWindowRows.length > 0) {
    const hasThunder = nearWindowRows.some(
      (r) => isThunderyHour(r) && isSignificantNearTerm(r),
    );
    /** storm = ⛈️ + warm danger accent; rain = 🌧️ + cool wet accent */
    const today_icon = hasThunder ? '⛈️' : '🌧️';
    const p = Math.round(Math.min(100, Math.max(0, nearMaxPop)));
    return {
      today_icon,
      today_advice: 'Rain possible within the next few hours',
      time_hint: buildTimeHintNearRain(nearWindowRows, tNow),
      mood: hasThunder ? 'storm' : 'rain',
      reliability: 'high',
      chance_of_rain_pct: p >= MIN_CHANCE_TO_SHOW ? p : 0,
    };
  }

  const futureSigs: SamuiWeatherForecastRow[] = [];
  for (const r of todayRows) {
    if (new Date(r.time).getTime() < tNow - 30 * 60 * 1000) continue;
    if (isSignificantHour(r) || (isThunderyHour(r) && (r.precipRate > 0.08 || effectivePop(r) >= 20)))
      futureSigs.push(r);
  }
  if (futureSigs.length > 0) {
    const first = futureSigs[0]!;
    const h = hourInBangkok(first.time);
    const tFirst = first.time;
    if (h >= LATE_SHOWERS_START_HOUR) {
      const isEvening = h >= 20;
      const pop = Math.round(
        Math.min(100, Math.max(maxEffectivePop(futureSigs), maxRestOfDayPop, effectivePop(first))),
      );
      return {
        today_icon: '🌦️',
        today_advice: isEvening
          ? 'Mostly dry, with a possible shower later today'
          : 'Mostly dry, but chance of showers later in the afternoon',
        time_hint: buildTimeHintLaterToday(h),
        mood: 'mixed',
        reliability: 'medium',
        chance_of_rain_pct: pop >= MIN_CHANCE_TO_SHOW ? pop : 0,
      };
    }
    /** Same icon + amber family as `mixed` — pattern is messier than timing. */
    return {
      today_icon: '🌦️',
      today_advice: 'Wet or unsettled at times today — see the hourly strip',
      time_hint:
        h < 12
          ? `this morning · around ${formatTimeBangkokEn(tFirst)}`
          : `from ~${formatTimeBangkokEn(tFirst)}`,
      mood: 'unsettled',
      reliability: 'trend',
      chance_of_rain_pct:
        maxRestOfDayPop >= MIN_CHANCE_TO_SHOW ? Math.round(maxRestOfDayPop) : 0,
    };
  }

  const d0 = new Date(todayRows[0]!.time);
  const dsum = d0.getUTCFullYear() + d0.getUTCMonth() * 31 + d0.getUTCDate();
  const dryPick = dsum % 2 === 0;
  return {
    today_icon: '☀️',
    today_advice: dryPick ? 'Excellent beach day' : 'Typical good Samui weather',
    time_hint: 'All day',
    /** beach: ☀️ + gold / emerald; see `todayCardMoodClass('beach')` */
    mood: 'beach',
    reliability: pickBeachReliability(maxRestOfDayPop),
    chance_of_rain_pct: maxRestOfDayPop > MIN_CHANCE_TO_SHOW ? Math.round(maxRestOfDayPop) : 0,
  };
}

/**
 * `reliability === 'high'` gets a **cool** outer glow (contrast) on top of the mood’s warm/cool
 * gradient; medium/trend keep a slimmer frame so “high” reads as a deliberate trust signal.
 */
function reliabilityHaloClass(rel: TodayReliability): string {
  if (rel === 'high') {
    return 'ring-2 ring-cyan-200/25 shadow-[0_0_0_1px_rgba(6,182,212,0.2),0_0_50px_rgba(34,211,238,0.18),0_0_90px_rgba(34,197,94,0.04)]';
  }
  if (rel === 'medium') {
    return 'ring-1 ring-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.06)]';
  }
  return 'ring-1 ring-slate-500/20 shadow-sm shadow-slate-950/80';
}

/**
 * One visual language: storm (red/orange), rain (blue), beach (emerald + gold), mixed+unsettled (amber, 🌦️).
 * Paired with `reliabilityHaloClass` for the outer edge.
 */
function todayCardMoodClass(m: TodayMood, rel: TodayReliability): {
  border: string;
  bg: string;
  headerText: string;
  ring: string;
  accentSubtext: string;
  badge: string;
} {
  const halo = reliabilityHaloClass(rel);

  const amberWetMood = {
    border: 'border-amber-500/40',
    bg: 'bg-gradient-to-b from-amber-900/40 via-amber-950/25 to-slate-950',
    headerText: 'text-white',
    ring: 'shadow-[inset_0_1px_0_0_rgba(252,211,77,0.1),0_0_32px_rgba(245,158,11,0.12)] ' + halo,
    accentSubtext: 'text-amber-200/90',
    badge: 'bg-amber-500/15 text-amber-100 border-amber-400/28',
  };

  switch (m) {
    case 'storm':
      return {
        border: 'border-red-500/35',
        bg: 'bg-gradient-to-b from-red-950/55 via-orange-900/40 to-slate-950',
        headerText: 'text-white',
        ring: 'shadow-[inset_0_1px_0_0_rgba(251,146,60,0.12),0_0_40px_rgba(220,38,38,0.14)] ' + halo,
        accentSubtext: 'text-orange-200/85',
        badge: 'bg-gradient-to-r from-red-500/20 to-orange-500/20 text-orange-100 border border-orange-500/25',
      };
    case 'rain':
      return {
        border: 'border-sky-500/40',
        bg: 'bg-gradient-to-b from-sky-900/50 via-cyan-950/25 to-slate-950',
        headerText: 'text-white',
        ring: 'shadow-[inset_0_1px_0_0_rgba(56,189,248,0.1),0_0_40px_rgba(14,165,233,0.15)] ' + halo,
        accentSubtext: 'text-sky-200/90',
        badge: 'bg-sky-500/15 text-sky-100 border-sky-400/25',
      };
    case 'beach':
      return {
        border: 'border-amber-400/40',
        bg: 'bg-gradient-to-b from-amber-400/15 via-emerald-900/40 to-slate-950',
        headerText: 'text-white',
        ring: 'shadow-[inset_0_1px_0_0_rgba(253,230,138,0.2),0_0_40px_rgba(16,185,129,0.12)] ' + halo,
        accentSubtext: 'text-amber-200/90',
        badge: 'bg-gradient-to-r from-amber-500/25 to-emerald-600/20 text-amber-50 border-amber-300/25',
      };
    case 'mixed':
    case 'unsettled':
      return amberWetMood;
    default:
      return amberWetMood;
  }
}

function getIconLegacy(day: DailyData, forceMoon = false) {
  const avgCloud = day.avgCloudCover / day.hoursCount;
  let Icon = forceMoon ? '🌙' : '☀️';
  if (day.maxPrecipRate > 1.5) Icon = '🌧️';
  else if (day.maxPrecipRate > 0.1) Icon = '🌦️';
  else if (avgCloud > 60) Icon = '☁️';
  else if (avgCloud > 20) Icon = forceMoon ? '☁️' : '⛅';
  return Icon;
}

export default function DailyForecast({ rows, onDayClick, sammiDailyByIsoDay }: DailyForecastProps) {
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);

  const dailyMap = new Map<string, DailyData>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const d = new Date(row.time);
    if (Number.isNaN(d.getTime())) continue;

    const dateStr = d.toLocaleDateString('en-US', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const dayName = d.toLocaleDateString('en-US', {
      timeZone: 'Asia/Bangkok',
      weekday: 'short',
    });

    const hourStr = d.toLocaleTimeString('en-US', { hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });
    const hour = parseInt(hourStr, 10);

    let pop = row.pop;
    if (!pop && row.precipRate > 0) {
      pop = Math.min(100, Math.round(row.precipRate * 20) + 20);
    }

    if (!dailyMap.has(dateStr)) {
      dailyMap.set(dateStr, {
        dateStr,
        dayName,
        minTemp: row.temp,
        maxTemp: row.temp,
        maxPop: pop,
        maxPrecipRate: row.precipRate,
        maxWindSpeed: row.windSpeed,
        maxWindGust: row.windGust,
        avgCloudCover: row.cloudCover,
        hoursCount: 1,
        noonIndex: i,
      });
    } else {
      const data = dailyMap.get(dateStr)!;
      data.minTemp = Math.min(data.minTemp, row.temp);
      data.maxTemp = Math.max(data.maxTemp, row.temp);
      data.maxPop = Math.max(data.maxPop, pop);
      data.maxPrecipRate = Math.max(data.maxPrecipRate, row.precipRate);
      data.maxWindSpeed = Math.max(data.maxWindSpeed, row.windSpeed);
      data.maxWindGust = Math.max(data.maxWindGust, row.windGust);
      data.avgCloudCover += row.cloudCover;
      data.hoursCount += 1;
      if (Math.abs(hour - 12) < 2) data.noonIndex = i;
    }
  }

  const todayKeyLive = bangkokDateKey(new Date());
  const bangkokTodayIso = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const sammiDay = sammiDailyByIsoDay?.[bangkokTodayIso] ?? null;
  const fullInsight: TodayCardInsight | null = sammiDay
    ? buildTodayCardInsightFromSammiDaily(sammiDay)
    : buildTodayCardInsightForRows(rows, new Date());
  if (fullInsight) {
    const d = dailyMap.get(todayKeyLive);
    if (d) d.today_insight = fullInsight;
  }

  const dailyArray = Array.from(dailyMap.values()).slice(0, MAX_DAILY_OUTLOOK);

  if (dailyArray.length === 0) return null;

  const currentSun = getSunInfo();
  const isNightCurrently = !currentSun.isDay;

  const handleDayTap = (day: DailyData) => {
    onDayClick?.(day.noonIndex);
    setExpandedDayKey((prev) => (prev === day.dateStr ? null : day.dateStr));
  };

  const expandedDay =
    expandedDayKey != null ? dailyArray.find((d) => d.dateStr === expandedDayKey) : null;

  const expandedLabel = expandedDay
    ? (() => {
        const i = dailyArray.findIndex((d) => d.dateStr === expandedDay.dateStr);
        const isHead = i === 0;
        const isTomorrow = i === 1;
        const label = isHead ? 'Today' : isTomorrow ? 'Tomorrow' : expandedDay.dayName;
        return `${label} · ${expandedDay.dateStr}`;
      })()
    : '';

  const dayCount = dailyArray.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 pl-1 pr-0.5">
        <p className="text-[9px] font-black uppercase tracking-widest text-cyan-400">
          Daily outlook · up to {MAX_DAILY_OUTLOOK} days · {dayCount} loaded · swipe · tap for hourly
        </p>
      </div>

      <HourlyScrollStrip scrollKey={dailyArray.length}>
        {dailyArray.map((day, index) => {
            const isHeadCard = index === 0;
            const isTomorrow = index === 1;
            const displayDay = isHeadCard ? 'Today' : isTomorrow ? 'Tomorrow' : day.dayName;
            const useMoon = isHeadCard && isNightCurrently;
            const insight = day.today_insight;
            const isProminentToday = Boolean(insight);
            const baseIcon = insight ? insight.today_icon : getIconLegacy(day, useMoon);
            const Icon = useMoon && insight && insight.today_icon === '☀️' ? '🌙' : baseIcon;
            const shortDate = (() => {
              const parts = day.dateStr.split('/');
              return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : day.dateStr;
            })();
            const isOpen = expandedDayKey === day.dateStr;
            const precipH = Math.min(18, Math.max(2, day.maxPrecipRate * 3));

            const tone = isProminentToday && insight
              ? todayCardMoodClass(insight.mood, insight.reliability)
              : null;
            const rel = insight ? reliabilityLabel(insight.reliability) : null;
            const showChance =
              insight && insight.chance_of_rain_pct > MIN_CHANCE_TO_SHOW;

            return (
              <button
                key={day.dateStr}
                type="button"
                onClick={() => handleDayTap(day)}
                className={[
                  isProminentToday && tone
                    ? 'relative min-h-[14rem] w-[7rem] shrink-0 snap-center flex flex-col items-stretch overflow-hidden rounded-2xl border px-2.5 py-3 text-left shadow-lg transition sm:min-h-[15rem] sm:w-[8rem] sm:px-3 sm:py-3.5'
                    : 'flex w-[5.25rem] shrink-0 snap-center flex-col items-center rounded-2xl border px-2 py-2.5 shadow-lg transition sm:w-[5.75rem] sm:px-2.5 sm:py-3',
                  isProminentToday && tone
                    ? [tone.border, tone.bg, tone.ring, 'text-left sm:min-w-[7.5rem]'].join(' ')
                    : isHeadCard
                      ? 'items-center border-cyan-500/40 bg-slate-900'
                      : 'items-center border-white/10 bg-slate-900',
                  isOpen
                    ? isProminentToday
                      ? 'ring-2 ring-cyan-400/55 ring-offset-0 ring-offset-transparent'
                      : 'ring-1 ring-cyan-500/45 ring-offset-0 ring-offset-slate-950 sm:ring-2'
                    : isProminentToday
                      ? 'hover:brightness-110'
                      : 'hover:border-cyan-500/25 hover:bg-slate-800',
                ].join(' ')}
              >
                {isProminentToday && rel && insight && tone ? (
                  <span
                    className={[
                      'mb-1.5 line-clamp-2 w-full max-w-[11.5rem] self-center text-center text-[5.5px] font-semibold leading-tight sm:mb-2 sm:max-w-none sm:px-1 sm:text-[6.5px]',
                      'rounded-full border px-1.5 py-1 not-italic normal-case',
                      tone.badge,
                    ].join(' ')}
                    title={rel.full}
                  >
                    {rel.short}
                  </span>
                ) : null}

                <span
                  className={[
                    'line-clamp-1 text-center text-[10px] font-bold leading-tight',
                    isProminentToday && insight && tone ? tone.headerText : isHeadCard ? 'text-white' : 'text-slate-300',
                  ].join(' ')}
                >
                  {displayDay}
                </span>
                <span
                  className={[
                    'mb-0.5 text-center text-[8px]',
                    isProminentToday && insight && tone ? tone.accentSubtext : 'text-slate-500',
                  ].join(' ')}
                >
                  {shortDate}
                </span>

                <div
                  className={[
                    'relative mb-1 flex w-full select-none items-center justify-center',
                    isProminentToday
                      ? 'min-h-16 text-[3rem] leading-none drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)] sm:min-h-[4.5rem] sm:text-[3.75rem] sm:leading-none'
                      : 'h-9 min-h-9 w-9 text-2xl sm:h-10 sm:min-h-10 sm:w-10 sm:text-3xl',
                  ].join(' ')}
                >
                  {Icon}
                  {!isProminentToday && day.maxPop >= 10 && (
                    <span className="absolute -bottom-1 text-[8px] font-black text-cyan-400">
                      {Math.round(day.maxPop)}%
                    </span>
                  )}
                </div>

                {isProminentToday && insight && tone ? (
                  <div className="mb-1 flex min-h-[2.5rem] flex-col gap-0.5 text-center sm:min-h-14">
                    <p className="line-clamp-2 text-[8px] font-semibold leading-snug text-white/95 sm:text-[9px]">
                      {insight.today_advice}
                    </p>
                    {insight.time_hint ? (
                      <p className="text-[7px] font-medium leading-tight text-white/60 sm:text-[8px]">
                        {insight.time_hint}
                      </p>
                    ) : null}
                    {showChance ? (
                      <p className="text-[7px] font-bold text-cyan-300/90 sm:text-[8px]">
                        {Math.round(insight.chance_of_rain_pct)}% chance of rain
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div
                  className={[
                    'mt-auto flex h-4 w-full items-end justify-center',
                    isProminentToday && insight && tone ? 'pt-0.5' : '',
                  ].join(' ')}
                >
                  <div
                    className="w-1 rounded-full bg-cyan-500/55"
                    style={{ height: `${precipH}px` }}
                    title="Precip intensity (proxy)"
                  />
                </div>

                <div
                  className={[
                    'mt-1 flex w-full items-center justify-between text-[10px] font-mono leading-none sm:text-[11px]',
                    isProminentToday && insight && tone ? 'px-0.5' : '',
                  ].join(' ')}
                >
                  <span className="font-bold text-white">{formatTempC(day.maxTemp)}°</span>
                  <span className="text-slate-400">{formatTempC(day.minTemp)}°</span>
                </div>

                <div
                  className={[
                    'mt-0.5 line-clamp-2 text-left text-[7px] sm:text-left sm:text-[8px]',
                    isProminentToday && insight && tone ? 'text-slate-400' : 'text-slate-500',
                  ].join(' ')}
                  title="Peak sustained wind that day (hourly Spire steps). Gust can be higher — see hourly tile for one hour."
                >
                  💨 {formatWindMs(day.maxWindSpeed)} m/s peak
                  {day.maxWindGust > day.maxWindSpeed + 0.05 ? (
                    <span className="block text-[6px] text-slate-600 sm:text-[7px]">
                      gust {formatWindMs(day.maxWindGust)} m/s
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
      </HourlyScrollStrip>

      {expandedDayKey && expandedDay && (
        <div className="rounded-2xl border border-cyan-500/25 bg-slate-950 px-3 py-3">
          <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-cyan-400">
            Hourly · {expandedLabel}
          </p>
          <HourlyStripForCalendarDay rows={rows} dateKey={expandedDayKey} />
        </div>
      )}
    </div>
  );
}
