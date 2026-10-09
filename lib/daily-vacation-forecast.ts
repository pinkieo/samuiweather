/**
 * Daily Vacation Brief — Koh Samui plan from hourly forecast rows still ahead.
 * Rain chance for a part of the day is the highest 1-hour chance in those hours.
 * The stored day average is not shown here.
 */

import { ageLabel, ageMinutes } from './data-freshness';
import {
  SPIRE_HOUR_STALE_AFTER_MINUTES,
  SPIRE_INGEST_STALE_AFTER_MINUTES,
} from './weather-provenance';
import { rainChancePercentForRow } from './sammi-views';
import type { SammiDailyForecastViewRow } from './sammi-views';
import type { SamuiWeatherForecastRow } from './spire';

export type PeriodId = 'morning' | 'afternoon' | 'evening' | 'night' | 'tonight';
export type BriefConfidence = 'ok' | 'stale' | 'insufficient';
export type VacationVerdict = 'Beach-first' | 'Flexible day' | 'Rain-aware day' | 'Indoor-first';
export type WindowKind = 'beach' | 'rain' | 'heat' | 'wind' | 'thunder' | 'evening';

export interface PeriodSnapshot {
  id: PeriodId;
  label: string;
  hourRange: string;
  hoursAvailable: number;
  hoursExpected: number;
  temp: { min: number | null; max: number | null };
  rainChancePct: number | null;
  rainRateMmH: number | null;
  rainAmountMm: number | null;
  windMs: number | null;
  thunderRiskPct: number | null;
  fogRiskPct: number | null;
  ceilingM: number | null;
  summary: string;
}

export interface TimeWindow {
  kind: WindowKind;
  startHour: number;
  endHourExclusive: number;
  label: string;
  text: string;
}

export interface BriefFreshnessInput {
  stale?: boolean;
  ageMinutes?: number | null;
  label?: string | null;
}

export interface DailyVacationBrief {
  place: 'Koh Samui';
  dateLabel: string;
  verdict: VacationVerdict;
  confidence: BriefConfidence;
  confidenceNote: string | null;
  stale: boolean;
  freshnessLabel: string | null;
  conclusions: string[];
  periods: PeriodSnapshot[];
  temperature: { min: number | null; max: number | null };
  rainChancePct: number | null;
  rainRateMmH: number | null;
  rainAmountMm: number | null;
  windMs: number | null;
  thunderRiskPct: number | null;
  fog: { relevant: boolean; chancePct: number | null; text: string | null };
  ceiling: { relevant: boolean; minM: number | null; text: string | null };
  windows: {
    beach: TimeWindow | null;
    rain: TimeWindow | null;
    heat: TimeWindow | null;
    wind: TimeWindow | null;
    thunder: TimeWindow | null;
    evening: TimeWindow | null;
  };
  summary: string;
  sourceLine: string;
  coverage: { available: number; expected: number };
}

/** Garden-station now. Used only in the daily paragraph, never copied onto a forecast hour. */
export interface BriefNowReading {
  fresh: boolean;
  late?: boolean;
  tempC: number | null;
  rainRateMmh: number | null;
  windSpeedMs: number | null;
}

const TIME_ZONE = 'Asia/Bangkok';
const STALE_AFTER_MINUTES = SPIRE_HOUR_STALE_AFTER_MINUTES;
const BEACH_START = 7;
const BEACH_END = 18;
const EVENING_START = 18;
const EVENING_END = 22;
const DRY_RAIN_CHANCE = 30;
const DRY_RAIN_RATE = 0.3;
const WET_RAIN_CHANCE = 35;
const WET_RAIN_RATE = 0.4;
const HEAVY_RAIN_RATE = 2;
const THUNDER_CHANCE = 20;
const THUNDER_CAPE = 1000;
const FOG_RELEVANT = 25;
const CEILING_RELEVANT_M = 800;
const MIN_BEACH_HOURS = 2;
const MIN_EVENING_HOURS = 2;
const MIN_DAYTIME_HOURS_FOR_WINDOWS = 6;

type PartSpec = {
  id: PeriodId;
  label: string;
  /** Inclusive start hour, ICT. */
  start: number;
  /** Exclusive end hour, ICT. Tonight ends at 06:00 the next day. */
  end: number;
  dayOffset: number;
  spansMidnight: boolean;
};

/** Three named parts that still have hours ahead. Empty parts are omitted later. */
export function comingUpParts(ictHour: number): PartSpec[] {
  if (ictHour < 6) {
    return [
      { id: 'night', label: 'Rest of the night', start: ictHour, end: 6, dayOffset: 0, spansMidnight: false },
      { id: 'morning', label: 'Morning', start: 6, end: 12, dayOffset: 0, spansMidnight: false },
      { id: 'afternoon', label: 'Midday', start: 12, end: 18, dayOffset: 0, spansMidnight: false },
    ];
  }
  if (ictHour < 12) {
    return [
      { id: 'morning', label: 'Morning', start: ictHour, end: 12, dayOffset: 0, spansMidnight: false },
      { id: 'afternoon', label: 'Midday', start: 12, end: 18, dayOffset: 0, spansMidnight: false },
      { id: 'evening', label: 'Evening', start: 18, end: 22, dayOffset: 0, spansMidnight: false },
    ];
  }
  if (ictHour < 18) {
    return [
      { id: 'afternoon', label: 'Midday', start: ictHour, end: 18, dayOffset: 0, spansMidnight: false },
      { id: 'evening', label: 'Evening', start: 18, end: 22, dayOffset: 0, spansMidnight: false },
      { id: 'morning', label: 'Tomorrow morning', start: 6, end: 12, dayOffset: 1, spansMidnight: false },
    ];
  }
  return [
    { id: 'tonight', label: 'Tonight', start: Math.max(18, ictHour), end: 6, dayOffset: 0, spansMidnight: true },
    { id: 'morning', label: 'Tomorrow morning', start: 6, end: 12, dayOffset: 1, spansMidnight: false },
    { id: 'afternoon', label: 'Tomorrow midday', start: 12, end: 18, dayOffset: 1, spansMidnight: false },
  ];
}

function shiftDateKey(key: string, days: number): string {
  const t = Date.parse(`${key}T00:00:00Z`);
  if (Number.isNaN(t)) return key;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

type HourView = {
  row: SamuiWeatherForecastRow;
  hour: number;
  rainChance: number;
  thunderChance: number | null;
  fogChance: number | null;
  ceilingM: number | null;
  thundery: boolean;
  dry: boolean;
  wet: boolean;
};

export function localDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function localHour(iso: string): number {
  const hourStr = new Date(iso).toLocaleTimeString('en-US', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  const h = parseInt(hourStr, 10);
  return Number.isFinite(h) ? h % 24 : 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatHourRange(startHour: number, endHourExclusive: number): string {
  const end = endHourExclusive === 0 ? 24 : endHourExclusive;
  return `${pad2(startHour)}:00–${pad2(end)}:00`;
}

function windowFromHours(kind: WindowKind, hours: HourView[], text: string): TimeWindow {
  const startHour = hours[0]!.hour;
  const endHourExclusive = hours[hours.length - 1]!.hour + 1;
  return {
    kind,
    startHour,
    endHourExclusive,
    label: formatHourRange(startHour, endHourExclusive),
    text,
  };
}

function finiteNums(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v));
}

function maxNum(values: Array<number | null | undefined>): number | null {
  const n = finiteNums(values);
  return n.length ? Math.max(...n) : null;
}

function minNum(values: Array<number | null | undefined>): number | null {
  const n = finiteNums(values);
  return n.length ? Math.min(...n) : null;
}

function thunderChance(row: SamuiWeatherForecastRow): number | null {
  const k = row.sammi?.kansOnweerPctSammi;
  return k != null && Number.isFinite(k) ? k : null;
}

function fogChance(row: SamuiWeatherForecastRow): number | null {
  const k = row.sammi?.kansMistPctSammi;
  return k != null && Number.isFinite(k) ? k : null;
}

function ceilingOf(row: SamuiWeatherForecastRow): number | null {
  if (row.cloudCeiling != null && Number.isFinite(row.cloudCeiling)) return row.cloudCeiling;
  if (row.sammi?.ceilingM != null && Number.isFinite(row.sammi.ceilingM)) return row.sammi.ceilingM;
  return null;
}

export function isThunderyHour(row: SamuiWeatherForecastRow): boolean {
  const chance = thunderChance(row);
  const cape = row.cape ?? 0;
  const wet = rainChancePercentForRow(row) >= 20 || row.precipRate >= 0.08;
  if (chance != null && chance >= THUNDER_CHANCE && (wet || cape >= THUNDER_CAPE)) return true;
  return cape >= THUNDER_CAPE && wet;
}

function toHourView(row: SamuiWeatherForecastRow): HourView {
  const rain = rainChancePercentForRow(row);
  const rate = row.precipRate;
  return {
    row,
    hour: localHour(row.time),
    rainChance: rain,
    thunderChance: thunderChance(row),
    fogChance: fogChance(row),
    ceilingM: ceilingOf(row),
    thundery: isThunderyHour(row),
    dry: rain < DRY_RAIN_CHANCE && rate < DRY_RAIN_RATE,
    wet: rain >= WET_RAIN_CHANCE || rate >= WET_RAIN_RATE,
  };
}

function inRange(hour: number, start: number, end: number): boolean {
  return hour >= start && hour < end;
}

function contiguousGroups(hours: HourView[]): HourView[][] {
  if (hours.length === 0) return [];
  const sorted = [...hours].sort((a, b) => a.hour - b.hour);
  const groups: HourView[][] = [];
  let current: HourView[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const hour = sorted[i]!;
    const prev = current[current.length - 1]!;
    if (hour.hour === prev.hour + 1) {
      current.push(hour);
    } else {
      groups.push(current);
      current = [hour];
    }
  }
  groups.push(current);
  return groups;
}

function hourScore(h: HourView): number {
  const temp = h.row.temp;
  return (
    h.rainChance +
    h.row.precipRate * 25 +
    Math.max(0, h.row.windSpeed - 6) * 4 +
    Math.max(0, temp - 32) * 3 +
    Math.max(0, h.row.cloudCover - 40) * 0.15
  );
}

function avgScore(hours: HourView[]): number {
  if (hours.length === 0) return Number.POSITIVE_INFINITY;
  return hours.reduce((sum, h) => sum + hourScore(h), 0) / hours.length;
}

function bestSubwindow(run: HourView[], minLen: number, maxLen: number): HourView[] {
  if (run.length < minLen) return [];
  let best: HourView[] = run.slice(0, Math.min(maxLen, run.length));
  let bestScore = avgScore(best);
  let bestLen = best.length;
  const cap = Math.min(maxLen, run.length);
  for (let len = minLen; len <= cap; len++) {
    for (let i = 0; i + len <= run.length; i++) {
      const slice = run.slice(i, i + len);
      const score = avgScore(slice);
      const longerNearlyAsGood = len > bestLen && score <= bestScore + 2;
      if (score < bestScore - 0.01 || longerNearlyAsGood) {
        best = slice;
        bestScore = score;
        bestLen = len;
      }
    }
  }
  return best;
}

function pickBeachWindow(hours: HourView[]): TimeWindow | null {
  const beachHours = hours.filter((h) => inRange(h.hour, BEACH_START, BEACH_END) && h.dry && !h.thundery);
  const runs = contiguousGroups(beachHours).filter((run) => run.length >= MIN_BEACH_HOURS);
  if (runs.length === 0) return null;
  let bestRun = runs[0]!;
  let bestRunScore = avgScore(bestRun);
  for (const run of runs.slice(1)) {
    const score = avgScore(run);
    if (score < bestRunScore || (Math.abs(score - bestRunScore) < 0.5 && run.length > bestRun.length)) {
      bestRun = run;
      bestRunScore = score;
    }
  }
  const windowHours = bestSubwindow(bestRun, MIN_BEACH_HOURS, 4);
  if (windowHours.length < MIN_BEACH_HOURS) return null;
  const w = windowFromHours('beach', windowHours, '');
  return { ...w, text: `Best beach window: ${w.label}` };
}

function pickRainWindow(hours: HourView[]): TimeWindow | null {
  const wetHours = hours.filter((h) => h.wet);
  const runs = contiguousGroups(wetHours);
  if (runs.length === 0) return null;
  let best = runs[0]!;
  for (const run of runs.slice(1)) {
    const bestIntensity = avgScore(best);
    const nextIntensity = avgScore(run);
    if (run.length > best.length || (run.length === best.length && nextIntensity > bestIntensity)) {
      best = run;
    }
  }
  const w = windowFromHours('rain', best, '');
  const morning = hours.filter((h) => inRange(h.hour, 6, 12));
  const morningMostlyDry =
    morning.length >= 3 && morning.filter((h) => h.dry).length >= Math.ceil(morning.length * 0.7);
  const text =
    morningMostlyDry && best[0]!.hour >= 12
      ? `Rain risk increases after ${pad2(best[0]!.hour)}:00`
      : `Wettest period: ${w.label}`;
  return { ...w, text };
}

function pickHeatWindow(hours: HourView[]): TimeWindow | null {
  if (hours.length === 0) return null;
  const maxTemp = Math.max(...hours.map((h) => h.row.temp));
  const hot = hours.filter((h) => h.row.temp >= maxTemp - 0.4);
  const run = contiguousGroups(hot).sort((a, b) => b.length - a.length)[0];
  if (!run?.length) return null;
  const w = windowFromHours('heat', run, '');
  const around =
    run.length === 1
      ? `Warmest around ${pad2(run[0]!.hour)}:00`
      : `Warmest part of the day: ${w.label}`;
  return { ...w, text: around };
}

function pickWindWindow(hours: HourView[]): TimeWindow | null {
  if (hours.length === 0) return null;
  const maxWind = Math.max(...hours.map((h) => h.row.windSpeed));
  if (maxWind < 7) return null;
  const windy = hours.filter((h) => h.row.windSpeed >= maxWind - 0.5);
  const run = contiguousGroups(windy).sort((a, b) => b.length - a.length)[0];
  if (!run?.length) return null;
  const w = windowFromHours('wind', run, '');
  const text =
    run.length === 1
      ? `Strongest wind around ${pad2(run[0]!.hour)}:00`
      : `Strongest wind: ${w.label}`;
  return { ...w, text };
}

function pickThunderWindow(hours: HourView[]): TimeWindow | null {
  const stormy = hours.filter((h) => h.thundery && inRange(h.hour, BEACH_START, EVENING_END));
  const runs = contiguousGroups(stormy);
  if (runs.length === 0) return null;
  const scored = runs.map((run) => {
    const chance = maxNum(run.map((h) => h.thunderChance)) ?? 0;
    const cape = maxNum(run.map((h) => h.row.cape ?? null)) ?? 0;
    return { run, score: chance * 2 + cape / 200 + run.length };
  });
  scored.sort((a, b) => b.score - a.score);
  const run = scored[0]!.run;
  const w = windowFromHours('thunder', run, '');
  return { ...w, text: `Thunderstorm risk highest around ${w.label}` };
}

function pickEveningWindow(hours: HourView[]): TimeWindow | null {
  const evening = hours.filter((h) => inRange(h.hour, EVENING_START, EVENING_END));
  if (evening.length < MIN_EVENING_HOURS) return null;
  const usable = evening.filter((h) => h.dry && !h.thundery && h.row.precipRate < WET_RAIN_RATE);
  const runs = contiguousGroups(usable).filter((run) => run.length >= MIN_EVENING_HOURS);
  if (runs.length === 0) return null;
  const run = runs.sort((a, b) => b.length - a.length)[0]!;
  if (run.length < evening.length * 0.5 && run.length < 3) return null;
  const w = windowFromHours('evening', run, '');
  return { ...w, text: 'Evening looks suitable for outdoor dinner' };
}

function rainIntensityLabel(rate: number | null): string | null {
  if (rate == null || rate < 0.2) return null;
  if (rate < 0.5) return 'light';
  if (rate < 2) return 'moderate';
  return 'heavy';
}

function spanFromSlice(slice: HourView[]): string {
  const first = slice[0]!;
  const last = slice[slice.length - 1]!;
  const endHour = (last.hour + 1) % 24;
  return `${pad2(first.hour)}:00–${pad2(endHour)}:00`;
}

function hourMatchesPart(spec: PartSpec, date: string, hour: number, today: string): boolean {
  const tomorrow = shiftDateKey(today, 1);
  if (spec.spansMidnight) {
    if (date === today && hour >= spec.start) return true;
    if (date === tomorrow && hour < spec.end) return true;
    return false;
  }
  const target = shiftDateKey(today, spec.dayOffset);
  return date === target && hour >= spec.start && hour < spec.end;
}

function snapshotForPart(spec: PartSpec, slice: HourView[]): PeriodSnapshot {
  const rainChance = maxNum(slice.map((h) => h.rainChance));
  const rainRate = maxNum(slice.map((h) => h.row.precipRate));
  const rainAmount = slice.some((h) => h.row.precip > 0)
    ? slice.reduce((sum, h) => sum + (Number.isFinite(h.row.precip) ? h.row.precip : 0), 0)
    : null;
  const thunder = maxNum(slice.map((h) => h.thunderChance));
  const hasThunder = slice.some((h) => h.thundery);
  const fog = maxNum(slice.map((h) => h.fogChance));
  const ceiling = minNum(slice.map((h) => h.ceilingM));
  let summary = 'Highest chance in these hours.';
  if (hasThunder || (thunder != null && thunder >= THUNDER_CHANCE)) {
    summary = 'Thunderstorm risk in this window — keep an indoor backup.';
  } else if ((rainRate != null && rainRate >= HEAVY_RAIN_RATE) || (rainChance != null && rainChance >= 60)) {
    summary = 'Wet stretch — covered activities fit better than the beach.';
  } else if ((rainRate != null && rainRate >= 0.5) || (rainChance != null && rainChance >= 45)) {
    summary = 'Showers likely; keep plans flexible and stay near cover.';
  } else if ((rainChance != null && rainChance >= 25) || (rainRate != null && rainRate >= 0.2)) {
    summary = 'Mostly usable, with a passing shower possible.';
  } else if (spec.id === 'evening') {
    summary = 'Looks suitable for an outdoor meal or village walk.';
  } else {
    summary = 'Driest, most usable outdoor stretch.';
  }
  return {
    id: spec.id,
    label: spec.label,
    hourRange: spanFromSlice(slice),
    hoursAvailable: slice.length,
    hoursExpected: slice.length,
    temp: {
      min: minNum(slice.map((h) => h.row.temp)),
      max: maxNum(slice.map((h) => h.row.temp)),
    },
    rainChancePct: rainChance != null ? Math.round(rainChance) : null,
    rainRateMmH: rainRate,
    rainAmountMm: rainAmount != null && rainAmount > 0 ? rainAmount : null,
    windMs: maxNum(slice.map((h) => h.row.windSpeed)),
    thunderRiskPct: thunder != null ? Math.round(thunder) : null,
    fogRiskPct: fog != null ? Math.round(fog) : null,
    ceilingM: ceiling,
    summary,
  };
}

function verdictFromHours(
  hours: HourView[],
  windows: DailyVacationBrief['windows'],
): VacationVerdict {
  const maxRate = maxNum(hours.map((h) => h.row.precipRate)) ?? 0;
  const maxRain = maxNum(hours.map((h) => h.rainChance)) ?? 0;
  const maxWind = maxNum(hours.map((h) => h.row.windSpeed)) ?? 0;
  const thunderHours = hours.filter((h) => h.thundery).length;
  const wetHours = hours.filter((h) => h.wet).length;
  const daytime = hours.filter((h) => inRange(h.hour, BEACH_START, BEACH_END));
  const wetDaytime = daytime.filter((h) => h.wet).length;

  const thunderDay = hours.filter((h) => h.thundery && inRange(h.hour, BEACH_START, EVENING_END)).length;
  if (maxRate >= HEAVY_RAIN_RATE || (wetDaytime >= 8 && thunderDay >= 1) || thunderHours >= 6) {
    return 'Indoor-first';
  }
  if (maxRate >= 0.5 || maxRain >= 45 || wetHours >= 6 || (windows.thunder && wetDaytime >= 4)) {
    return 'Rain-aware day';
  }
  if (maxRain >= 25 || maxWind >= 8 || windows.rain || !windows.beach) {
    return 'Flexible day';
  }
  return 'Beach-first';
}

function closestRow(rows: SamuiWeatherForecastRow[], now: number): SamuiWeatherForecastRow | null {
  if (rows.length === 0) return null;
  let best = rows[0]!;
  let bestDelta = Math.abs(new Date(best.time).getTime() - now);
  for (const row of rows) {
    const delta = Math.abs(new Date(row.time).getTime() - now);
    if (delta < bestDelta) {
      best = row;
      bestDelta = delta;
    }
  }
  return best;
}

function assessCoverage(
  hours: HourView[],
  now: number,
  allRows: SamuiWeatherForecastRow[],
  freshness?: BriefFreshnessInput,
): { stale: boolean; insufficient: boolean; note: string | null; label: string | null } {
  const available = hours.filter((h) => inRange(h.hour, 6, 22)).length;
  const daytime = hours.filter((h) => inRange(h.hour, BEACH_START, BEACH_END)).length;
  const lead = closestRow(allRows, now);
  const nowUnix = Math.floor(now / 1000);
  const leadAge =
    lead != null
      ? ageMinutes(Math.floor(new Date(lead.time).getTime() / 1000), nowUnix)
      : null;
  const staleFromInput = freshness?.stale === true;
  const staleFromAge =
    (freshness?.ageMinutes != null && freshness.ageMinutes > SPIRE_INGEST_STALE_AFTER_MINUTES) ||
    (leadAge != null && leadAge > STALE_AFTER_MINUTES);
  const stale = staleFromInput || staleFromAge;
  const insufficient =
    available < MIN_DAYTIME_HOURS_FOR_WINDOWS || daytime < MIN_DAYTIME_HOURS_FOR_WINDOWS;

  const ageForLabel = freshness?.ageMinutes ?? leadAge;
  let label = freshness?.label ?? null;
  if (!label && ageForLabel != null) label = ageLabel(ageForLabel);
  if (stale && !label) label = 'delayed';

  if (stale) {
    return {
      stale: true,
      insufficient,
      note: 'Forecast is delayed.',
      label,
    };
  }
  return { stale: false, insufficient: false, note: null, label };
}

function pickConclusions(args: {
  confidence: BriefConfidence;
  note: string | null;
  hours: HourView[];
  windows: DailyVacationBrief['windows'];
  fogText: string | null;
  allowWindows: boolean;
}): string[] {
  const { note, hours, windows, fogText, allowWindows } = args;
  const picked: string[] = [];
  if (note) picked.push(note);

  if (allowWindows) {
    if (windows.beach) picked.push(windows.beach.text);
    else if (hours.filter((h) => inRange(h.hour, BEACH_START, BEACH_END)).length >= MIN_DAYTIME_HOURS_FOR_WINDOWS) {
      picked.push('No clear beach window today');
    }

    if (windows.thunder) picked.push(windows.thunder.text);
    if (windows.rain && !picked.includes(windows.rain.text)) picked.push(windows.rain.text);
    if (windows.evening) picked.push(windows.evening.text);
    else if (
      hours.filter((h) => inRange(h.hour, EVENING_START, EVENING_END)).length >= MIN_EVENING_HOURS &&
      hours.filter((h) => inRange(h.hour, EVENING_START, EVENING_END) && h.wet).length >= 2
    ) {
      picked.push('Evening is less suitable for outdoor dining');
    }
    if (fogText) picked.push(fogText);
    if (windows.heat && (maxNum(hours.map((h) => h.row.temp)) ?? 0) >= 33) {
      picked.push(windows.heat.text);
    }
    if (windows.wind) picked.push(windows.wind.text);
  }

  const daytime = hours.filter((h) => inRange(h.hour, BEACH_START, BEACH_END));
  if (picked.length < 3 && daytime.length > 0 && allowWindows) {
    const rain = Math.round(maxNum(daytime.map((h) => h.rainChance)) ?? 0);
    picked.push(`Daytime rain chance peaks at ${rain}%`);
  }
  return picked;
}

const GAUGE_DRY_MMH = 0.05;

function roundWhole(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n);
}

function touristLine(verdict: VacationVerdict): string {
  switch (verdict) {
    case 'Beach-first':
      return 'Normal tourist day.';
    case 'Flexible day':
      return 'Normal tourist day with a light shower backup.';
    case 'Rain-aware day':
      return 'Keep a covered plan.';
    case 'Indoor-first':
      return 'Indoor-first day.';
  }
}

function nowClause(
  nowReading: BriefNowReading | null | undefined,
  forecastNow: { tempC: number | null; windSpeedMs: number | null } | null,
): string {
  const fresh =
    nowReading?.fresh === true &&
    nowReading.tempC != null &&
    Number.isFinite(nowReading.tempC);
  if (fresh) {
    const gauge = (nowReading.rainRateMmh ?? 0) < GAUGE_DRY_MMH ? 'dry' : 'raining';
    return `Right now ${roundWhole(nowReading.tempC)}°C, ${gauge} on the gauge.`;
  }
  const temp = roundWhole(forecastNow?.tempC);
  const wind = roundWhole(forecastNow?.windSpeedMs);
  const bits = ['The station reading is late.'];
  if (temp != null && wind != null) {
    bits.push(`The current hour is ${temp}°C with wind ${wind} m/s.`);
  } else if (temp != null) {
    bits.push(`The current hour is ${temp}°C.`);
  } else if (wind != null) {
    bits.push(`The current hour has wind ${wind} m/s.`);
  }
  return bits.join(' ');
}

function dayClause(args: {
  temperature: { min: number | null; max: number | null };
  rainChancePct: number | null;
  windMs: number | null;
}): string {
  const lo = roundWhole(args.temperature.min);
  const hi = roundWhole(args.temperature.max);
  const bits: string[] = [];
  if (lo != null && hi != null && lo !== hi) bits.push(`about ${lo}\u2013${hi}°C`);
  else if (lo != null || hi != null) bits.push(`about ${lo ?? hi}°C`);
  if (args.rainChancePct != null && Number.isFinite(args.rainChancePct)) {
    bits.push(`chance of rain up to ${Math.round(args.rainChancePct)}%`);
  }
  const wind = roundWhole(args.windMs);
  if (wind != null) bits.push(`wind up to ${wind} m/s`);
  if (bits.length === 0) return '';
  return `Day: ${bits.join(', ')}.`;
}

/** One daily paragraph. Same figures as Coming up. No second rain percentage. */
export function buildSammiDaySummary(args: {
  allowWindows: boolean;
  verdict: VacationVerdict;
  temperature: { min: number | null; max: number | null };
  rainChancePct: number | null;
  windMs: number | null;
  nowReading?: BriefNowReading | null;
  forecastNow?: { tempC: number | null; windSpeedMs: number | null } | null;
}): string {
  if (!args.allowWindows) return 'Forecast is delayed.';
  return [
    nowClause(args.nowReading, args.forecastNow ?? null),
    dayClause(args),
    touristLine(args.verdict),
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildDailyVacationBrief(
  rows: SamuiWeatherForecastRow[],
  opts?: {
    now?: number;
    sammiDaily?: SammiDailyForecastViewRow | null;
    freshness?: BriefFreshnessInput;
    nowReading?: BriefNowReading | null;
  },
): DailyVacationBrief {
  const now = opts?.now ?? Date.now();
  const hourStart = now - (now % 3_600_000);
  const todayKey = localDateKey(new Date(now).toISOString());
  const ictHour = localHour(new Date(now).toISOString());
  const byKey = new Map<string, HourView>();
  for (const row of rows) {
    const t = new Date(row.time).getTime();
    if (Number.isNaN(t) || t < hourStart) continue;
    const key = `${localDateKey(row.time)}-${localHour(row.time)}`;
    if (!byKey.has(key)) byKey.set(key, toHourView(row));
  }
  const ahead = [...byKey.values()].sort(
    (a, b) => new Date(a.row.time).getTime() - new Date(b.row.time).getTime(),
  );
  const periods = comingUpParts(ictHour)
    .map((spec) => {
      const slice = ahead.filter((h) =>
        hourMatchesPart(spec, localDateKey(h.row.time), h.hour, todayKey),
      );
      return slice.length > 0 ? snapshotForPart(spec, slice) : null;
    })
    .filter((p): p is PeriodSnapshot => p != null);
  const hours = ahead.filter((h) => periods.some((p) => {
    const spec = comingUpParts(ictHour).find((s) => s.id === p.id && s.label === p.label);
    return spec != null && hourMatchesPart(spec, localDateKey(h.row.time), h.hour, todayKey);
  }));
  const coverage = assessCoverage(hours, now, rows, opts?.freshness);
  const allowWindows = !coverage.stale;

  const beach = allowWindows ? pickBeachWindow(hours) : null;
  const rain = allowWindows ? pickRainWindow(hours) : null;
  const heat = allowWindows && hours.length ? pickHeatWindow(hours) : null;
  const wind = allowWindows && hours.length ? pickWindWindow(hours) : null;
  const thunder = allowWindows ? pickThunderWindow(hours) : null;
  const evening = allowWindows ? pickEveningWindow(hours) : null;
  const windows = { beach, rain, heat, wind, thunder, evening };

  const temperature = {
    min: minNum(hours.map((h) => h.row.temp)),
    max: maxNum(hours.map((h) => h.row.temp)),
  };
  const hourlyRain = maxNum(hours.map((h) => h.rainChance));
  const rainChancePct = hourlyRain != null ? Math.round(hourlyRain) : null;
  const thunderHourly = maxNum(hours.map((h) => h.thunderChance));
  const thunderRiskPct = thunderHourly != null ? Math.round(thunderHourly) : null;
  const rainRateMmH = maxNum(hours.map((h) => h.row.precipRate));
  const rainAmountMm = hours.some((h) => h.row.precip > 0)
    ? hours.reduce((sum, h) => sum + (Number.isFinite(h.row.precip) ? h.row.precip : 0), 0)
    : null;
  const windMs = maxNum(hours.map((h) => h.row.windSpeed));

  const fogHours = hours.filter((h) => (h.fogChance ?? 0) >= FOG_RELEVANT);
  const morningFog = maxNum(
    hours.filter((h) => inRange(h.hour, 6, 10)).map((h) => h.fogChance),
  );
  const fogChanceMax = maxNum(hours.map((h) => h.fogChance));
  const fogRelevant =
    fogHours.length >= 2 || (morningFog != null && morningFog >= 20);
  const fogText = fogRelevant
    ? morningFog != null && morningFog >= 20
      ? `Morning fog or low visibility possible (${Math.round(morningFog)}%)`
      : `Fog or low visibility risk up to ${Math.round(maxNum(fogHours.map((h) => h.fogChance))!)}%`
    : null;

  const ceilingMin = minNum(hours.map((h) => h.ceilingM));
  const ceilingRelevant = ceilingMin != null && ceilingMin <= CEILING_RELEVANT_M;
  const ceilingText = ceilingRelevant
    ? `Low cloud base around ${Math.round(ceilingMin!)} m — beach sky may look grey`
    : null;

  const confidence: BriefConfidence = coverage.stale ? 'stale' : 'ok';
  const verdict = allowWindows ? verdictFromHours(hours, windows) : 'Flexible day';
  const conclusions = pickConclusions({
    confidence,
    note: coverage.note,
    hours,
    windows,
    fogText,
    allowWindows,
  });

  const dateLabel = new Date(hours[0]?.row.time ?? now).toLocaleDateString('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const sourceLine = 'Spire hourly forecast. Rain chance is the highest hour in each part';

  return {
    place: 'Koh Samui',
    dateLabel,
    verdict,
    confidence,
    confidenceNote: coverage.note,
    stale: coverage.stale,
    freshnessLabel: coverage.label,
    conclusions,
    periods,
    temperature,
    rainChancePct,
    rainRateMmH,
    rainAmountMm,
    windMs,
    thunderRiskPct,
    fog: { relevant: fogRelevant, chancePct: fogChanceMax, text: fogText },
    ceiling: { relevant: ceilingRelevant, minM: ceilingMin, text: ceilingText },
    windows,
    summary: buildSammiDaySummary({
      allowWindows,
      verdict,
      temperature,
      rainChancePct,
      windMs,
      nowReading: opts?.nowReading ?? null,
      forecastNow: ahead[0]
        ? { tempC: ahead[0].row.temp, windSpeedMs: ahead[0].row.windSpeed }
        : null,
    }),
    sourceLine,
    coverage: {
      available: hours.filter((h) => inRange(h.hour, 6, 22)).length,
      expected: Math.max(hours.length, 1),
    },
  };
}

/** @deprecated area cards were replaced by the island-wide Daily Vacation Brief */
export function buildDailyVacationBriefs(
  rows: SamuiWeatherForecastRow[],
  now = Date.now(),
): DailyVacationBrief[] {
  const brief = buildDailyVacationBrief(rows, { now });
  return [brief];
}

export function rainIntensityForDisplay(rate: number | null): string | null {
  return rainIntensityLabel(rate);
}
