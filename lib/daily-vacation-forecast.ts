/**
 * Daily Vacation Brief — Koh Samui day plan from hourly forecast rows.
 * Day totals may come from `sammi_daily_forecast`; time windows always come from hours.
 */

import { ageLabel, ageMinutes } from './data-freshness';
import { rainChancePercentForRow } from './sammi-views';
import type { SammiDailyForecastViewRow } from './sammi-views';
import type { SamuiWeatherForecastRow } from './spire';

export type PeriodId = 'morning' | 'afternoon' | 'evening';
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
  conclusions: [string, string, string];
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

const TIME_ZONE = 'Asia/Bangkok';
const STALE_AFTER_MINUTES = 90;
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

const PERIODS: { id: PeriodId; label: string; start: number; end: number }[] = [
  { id: 'morning', label: 'Morning', start: 6, end: 12 },
  { id: 'afternoon', label: 'Afternoon', start: 12, end: 18 },
  { id: 'evening', label: 'Evening', start: 18, end: 22 },
];

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

function todayRows(rows: SamuiWeatherForecastRow[], now: number): SamuiWeatherForecastRow[] {
  const today = localDateKey(new Date(now).toISOString());
  return rows
    .filter((row) => localDateKey(row.time) === today)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

function uniqueByHour(rows: SamuiWeatherForecastRow[]): HourView[] {
  const byHour = new Map<number, HourView>();
  for (const row of rows) {
    const view = toHourView(row);
    if (!byHour.has(view.hour)) byHour.set(view.hour, view);
  }
  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
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

function periodSnapshot(id: PeriodId, hours: HourView[]): PeriodSnapshot {
  const def = PERIODS.find((p) => p.id === id)!;
  const slice = hours.filter((h) => inRange(h.hour, def.start, def.end));
  const expected = def.end - def.start;
  const rainChance = maxNum(slice.map((h) => h.rainChance));
  const rainRate = maxNum(slice.map((h) => h.row.precipRate));
  const rainAmount = slice.some((h) => h.row.precip > 0)
    ? slice.reduce((sum, h) => sum + (Number.isFinite(h.row.precip) ? h.row.precip : 0), 0)
    : null;
  const thunder = maxNum(slice.map((h) => h.thunderChance));
  const hasThunder = slice.some((h) => h.thundery);
  const fog = maxNum(slice.map((h) => h.fogChance));
  const ceiling = minNum(slice.map((h) => h.ceilingM));
  let summary = 'Not enough hourly data for this part of the day.';
  if (slice.length > 0) {
    if (hasThunder || (thunder != null && thunder >= THUNDER_CHANCE)) {
      summary = 'Thunderstorm risk in this window — keep an indoor backup.';
    } else if ((rainRate != null && rainRate >= HEAVY_RAIN_RATE) || (rainChance != null && rainChance >= 60)) {
      summary = 'Wet stretch — covered activities fit better than the beach.';
    } else if ((rainRate != null && rainRate >= 0.5) || (rainChance != null && rainChance >= 45)) {
      summary = 'Showers likely; keep plans flexible and stay near cover.';
    } else if ((rainChance != null && rainChance >= 25) || (rainRate != null && rainRate >= 0.2)) {
      summary = 'Mostly usable, with a passing shower possible.';
    } else if (id === 'evening') {
      summary = 'Looks suitable for an outdoor meal or village walk.';
    } else {
      summary = 'Driest, most usable outdoor stretch.';
    }
  }
  return {
    id,
    label: def.label,
    hourRange: formatHourRange(def.start, def.end),
    hoursAvailable: slice.length,
    hoursExpected: expected,
    temp: {
      min: minNum(slice.map((h) => h.row.temp)),
      max: maxNum(slice.map((h) => h.row.temp)),
    },
    rainChancePct: rainChance != null ? Math.round(rainChance) : null,
    rainRateMmH: rainRate,
    rainAmountMm: rainAmount != null && rainAmount > 0 ? rainAmount : null,
    windMs: maxNum(slice.map((h) => h.row.windSpeed)),
    thunderRiskPct: thunder != null ? Math.round(thunder) : hasThunder ? null : null,
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
    (freshness?.ageMinutes != null && freshness.ageMinutes > STALE_AFTER_MINUTES) ||
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
      note: 'Forecast is delayed. Beach and dinner windows are withheld until a fresh run is in.',
      label,
    };
  }
  if (insufficient) {
    return {
      stale: false,
      insufficient: true,
      note: 'Hourly coverage is too thin to name beach or dinner windows.',
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
}): [string, string, string] {
  const { confidence, note, hours, windows, fogText, allowWindows } = args;
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
  if (picked.length < 3 && daytime.length > 0) {
    const rain = Math.round(maxNum(daytime.map((h) => h.rainChance)) ?? 0);
    picked.push(`Daytime rain chance peaks at ${rain}%`);
  }
  if (picked.length < 3) {
    const temps = finiteNums(hours.map((h) => h.row.temp));
    if (temps.length) {
      picked.push(`Temperature ${Math.round(Math.min(...temps))}–${Math.round(Math.max(...temps))}°C`);
    }
  }
  while (picked.length < 3) picked.push('See hourly forecast for timing.');
  return [picked[0]!, picked[1]!, picked[2]!];
}

function buildSummary(args: {
  allowWindows: boolean;
  confidence: BriefConfidence;
  note: string | null;
  periods: PeriodSnapshot[];
  windows: DailyVacationBrief['windows'];
  temperature: { min: number | null; max: number | null };
}): string {
  if (!args.allowWindows) {
    return args.note ?? 'Not enough trustworthy hourly data for a vacation plan yet.';
  }
  const bits: string[] = [];
  if (args.windows.beach) bits.push(args.windows.beach.text.replace('Best beach window: ', 'Best outdoor stretch is '));
  else bits.push('There is no clear dry beach window');
  if (args.windows.rain) bits.push(args.windows.rain.text.charAt(0).toLowerCase() + args.windows.rain.text.slice(1));
  if (args.windows.thunder) bits.push(args.windows.thunder.text.charAt(0).toLowerCase() + args.windows.thunder.text.slice(1));
  if (args.windows.evening) bits.push('evening still works for an outdoor meal');
  const t = args.temperature;
  if (t.min != null && t.max != null) {
    bits.push(`air temperature ${Math.round(t.min)}–${Math.round(t.max)}°C`);
  }
  const sentence = bits.join('; ') + '.';
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function buildDailyVacationBrief(
  rows: SamuiWeatherForecastRow[],
  opts?: {
    now?: number;
    sammiDaily?: SammiDailyForecastViewRow | null;
    freshness?: BriefFreshnessInput;
  },
): DailyVacationBrief {
  const now = opts?.now ?? Date.now();
  const sammiDaily = opts?.sammiDaily ?? null;
  const selected = todayRows(rows, now);
  const hours = uniqueByHour(selected);
  const coverage = assessCoverage(hours, now, selected.length ? selected : rows, opts?.freshness);
  const allowWindows = !coverage.stale && !coverage.insufficient;

  const beach = allowWindows ? pickBeachWindow(hours) : null;
  const rain = allowWindows ? pickRainWindow(hours) : null;
  const heat = hours.length ? pickHeatWindow(hours) : null;
  const wind = hours.length ? pickWindWindow(hours) : null;
  const thunder = allowWindows ? pickThunderWindow(hours) : null;
  const evening = allowWindows ? pickEveningWindow(hours) : null;
  const windows = { beach, rain, heat, wind, thunder, evening };

  const periods = PERIODS.map((p) => periodSnapshot(p.id, hours));
  const vacationHours = hours.filter((h) => inRange(h.hour, 6, 22));
  const hourlyTempMin = minNum(vacationHours.map((h) => h.row.temp));
  const hourlyTempMax = maxNum(vacationHours.map((h) => h.row.temp));
  const temperature = {
    min: hourlyTempMin ?? sammiDaily?.min_temp_c ?? null,
    max: hourlyTempMax ?? sammiDaily?.max_temp_c ?? null,
  };
  const hourlyRain = maxNum(vacationHours.map((h) => h.rainChance));
  const rainChancePct =
    hourlyRain != null
      ? Math.round(hourlyRain)
      : sammiDaily?.kans_regen_pct_sammi != null
        ? Math.round(sammiDaily.kans_regen_pct_sammi)
        : hours.length
          ? 0
          : null;
  const thunderRiskPct = (() => {
    const hourly = maxNum(vacationHours.map((h) => h.thunderChance));
    if (hourly != null) return Math.round(hourly);
    const daily = sammiDaily?.kans_onweer_pct_sammi ?? null;
    if (daily != null) return Math.round(daily);
    return vacationHours.some((h) => h.thundery) ? null : 0;
  })();
  const rainRateMmH = maxNum(hours.map((h) => h.row.precipRate));
  const rainAmountMm = hours.some((h) => h.row.precip > 0)
    ? hours.reduce((sum, h) => sum + (Number.isFinite(h.row.precip) ? h.row.precip : 0), 0)
    : null;
  const windMs = maxNum(hours.map((h) => h.row.windSpeed));

  const fogHours = vacationHours.filter((h) => (h.fogChance ?? 0) >= FOG_RELEVANT);
  const morningFog = maxNum(
    hours.filter((h) => inRange(h.hour, 6, 10)).map((h) => h.fogChance),
  );
  const fogChanceMax = maxNum(vacationHours.map((h) => h.fogChance));
  const fogRelevant =
    fogHours.length >= 2 || (morningFog != null && morningFog >= 20);
  const fogText = fogRelevant
    ? morningFog != null && morningFog >= 20
      ? `Morning fog or low visibility possible (${Math.round(morningFog)}%)`
      : `Fog or low visibility risk up to ${Math.round(maxNum(fogHours.map((h) => h.fogChance))!)}%`
    : null;

  const hourlyCeiling = minNum(hours.map((h) => h.ceilingM));
  const ceilingMin = minNum([hourlyCeiling, sammiDaily?.conv_ceiling_min ?? null]);
  const ceilingRelevant = ceilingMin != null && ceilingMin <= CEILING_RELEVANT_M;
  const ceilingText = ceilingRelevant
    ? `Low cloud base around ${Math.round(ceilingMin!)} m — beach sky may look grey`
    : null;

  const confidence: BriefConfidence = coverage.stale
    ? 'stale'
    : coverage.insufficient
      ? 'insufficient'
      : 'ok';
  const verdict = allowWindows ? verdictFromHours(hours, windows) : 'Flexible day';
  const conclusions = pickConclusions({
    confidence,
    note: coverage.note,
    hours,
    windows,
    fogText,
    allowWindows,
  });

  const dateLabel = new Date(selected[0]?.time ?? now).toLocaleDateString('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const sourceBits = [
    'Spire hourly forecast with Samui Optimized Point probability overlay',
  ];
  if (sammiDaily) sourceBits.push('sammi_daily_forecast day totals');

  const expected = PERIODS.reduce((n, p) => n + (p.end - p.start), 0);

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
    summary: buildSummary({
      allowWindows,
      confidence,
      note: coverage.note,
      periods,
      windows,
      temperature,
    }),
    sourceLine: sourceBits.join('; '),
    coverage: { available: hours.filter((h) => inRange(h.hour, 6, 22)).length, expected },
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
