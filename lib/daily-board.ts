/**
 * Guest daily forecast board — pure shaping.
 * Temperatures may be shifted by recent hour-of-day bias versus the garden
 * station. Rain stays a chance. Missing fields stay null (never a fake zero).
 */

export const BOARD_TIME_ZONE = 'Asia/Bangkok';

export const BOARD_BLOCKS = [
  { id: 'morning', label: 'Morning', startHour: 6, endHour: 10 },
  { id: 'midday', label: 'Midday', startHour: 10, endHour: 14 },
  { id: 'afternoon', label: 'Afternoon', startHour: 14, endHour: 18 },
  { id: 'evening', label: 'Evening', startHour: 18, endHour: 22 },
] as const;

export type BoardBlockId = (typeof BOARD_BLOCKS)[number]['id'];

/** Shores read from separate Spire point calls. Not extra history locations. */
export const BOARD_REGIONS = ['north', 'east', 'south', 'west'] as const;

export type BoardRegionId = (typeof BOARD_REGIONS)[number];

/** Inclusive start, exclusive end, ICT. */
export const BOARD_HOUR_START = 6;
export const BOARD_HOUR_END = 22;

/** How often an open TV re-reads the server board. Long enough to spare Spire. */
export const BOARD_LIVE_REFRESH_MS = 5 * 60 * 1000;

/** Prior ICT days used to estimate hour-of-day temperature bias. */
export const BIAS_LOOKBACK_DAYS = 10;
/** Kept pairs required before a correction is applied. */
export const BIAS_MIN_SAMPLES = 4;
/** Drop a pair when |forecast − station| exceeds this (sensor or unit glitch). */
export const BIAS_MAX_ABS_ERROR_C = 8;
/** Whole-degree board only says "adjusted" once the shift is this large. */
export const BIAS_VISIBLE_C = 0.4;

export type SkyKind = 'sun' | 'cloud' | 'shower' | 'thunder' | 'unavailable';
export type ThunderRisk = 'low' | 'possible' | 'higher';
export type ShowerShade = 'unavailable' | 'dry' | 'possible' | 'likely' | 'heavy';

export type BoardHourInput = {
  timeUtc: string;
  tempC: number | null;
  /** 0–100. Null when the forecast did not include a chance. */
  rainChancePct: number | null;
  cloudCoverPct: number | null;
  /** Convective available potential energy, J/kg. */
  capeJkg: number | null;
  windMs: number | null;
  uvIndex: number | null;
  /** Where `uvIndex` came from. Null when unknown or no index. */
  uvSource?: BoardUvSource | null;
};

export type TemperaturePair = {
  validTimeUtc: string;
  forecastTempC: number;
  stationTempC: number;
};

export type HourBias = {
  ictHour: number;
  samples: number;
  /** Mean (forecast − station) °C. Null until enough kept pairs. */
  biasC: number | null;
};

export type BoardHourView = {
  ictHour: number;
  present: boolean;
  rainChancePct: number | null;
  rainLabel: string;
  thunderRisk: ThunderRisk | null;
  thunderLabel: string;
  uvLabel: string;
  windLabel: string;
  sky: SkyKind;
};

export type BoardRegionView = {
  id: BoardRegionId;
  shade: ShowerShade;
};

export type CoastRateHour = {
  region: BoardRegionId;
  timeUtc: string;
  /** Spire `precipitation_rate` for that shore. Null when the field was absent. */
  rateMmHr: number | null;
};

export type BoardBlockView = {
  id: BoardBlockId;
  label: string;
  hourRange: string;
  sky: SkyKind;
  tempLabel: string;
  adjusted: boolean;
  rainChancePct: number | null;
  rainWords: string | null;
  /** Island-point chance, for the words on the card. Not painted on every shore. */
  shade: ShowerShade;
  regions: BoardRegionView[];
  thunderRisk: ThunderRisk | null;
  uvMax: number | null;
};

export type DailyBoardMode = 'live' | 'sample' | 'unavailable';

export type DailyBoard = {
  mode: DailyBoardMode;
  dateYmd: string;
  dateLabel: string;
  issuedLabel: string | null;
  blocks: BoardBlockView[];
  hours: BoardHourView[];
  bestForToday: string;
  biasSummary: string;
  /** Names the UV source(s). Null when the UV row is empty. */
  uvNote: string | null;
  credit: string;
  mapCaption: string;
};

const CREDIT =
  'Spire hourly forecast for Koh Samui. Rain is a chance of showers, not a rainfall total. Thunder follows CAPE. Temperatures use the Baan Ton Kluay garden station when recent hours allow. Not live radar.';

function mapCaption(regionRead: 'live' | 'sample' | 'unread'): string {
  if (regionRead === 'sample') {
    return 'Sample shores are shaded differently on purpose. These are not live coast readings. Gold dot: garden station.';
  }
  if (regionRead === 'live') {
    return 'Each shore uses its own forecast rain rate for that part of the day. It is not the island-wide chance. Gold dot: garden station.';
  }
  return 'The stored forecast is one island point. Coast rain rates were not available, so they are not copied from that point. Gold dot: garden station.';
}

function finite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function ictHourFromUtc(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const hourStr = new Date(t).toLocaleTimeString('en-US', {
    timeZone: BOARD_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  const h = parseInt(hourStr, 10);
  if (!Number.isFinite(h)) return null;
  return h % 24;
}

export function ictDateKey(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const key = new Date(t).toLocaleDateString('en-CA', {
    timeZone: BOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

/** UTC hour bucket, matching forecast-day accuracy pairing. */
export function utcHourKey(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(Math.floor(t / 3_600_000) * 3_600_000).toISOString();
}

/**
 * Stored probabilities are 0–100. A leftover fraction in (0, 1) is scaled.
 * Exactly 1 stays 1 — it is 1%, not 100% (same rule as sammi_forecast).
 */
export function normalizeChancePercent(raw: number | null | undefined): number | null {
  if (!finite(raw) || raw < 0) return null;
  if (raw > 0 && raw < 1) return Math.round(raw * 1000) / 10;
  if (raw <= 100) return Math.round(raw * 10) / 10;
  return null;
}

/** Cloud cover: 0–1 is a fraction (including 1 = overcast). Above 1 is already a percent. */
export function normalizeCloudPercent(raw: number | null | undefined): number | null {
  if (!finite(raw) || raw < 0) return null;
  if (raw <= 1) return Math.round(raw * 1000) / 10;
  if (raw <= 100) return Math.round(raw * 10) / 10;
  return null;
}

/**
 * Thunder risk from CAPE, with rain chance as support when that field exists.
 * A missing CAPE is unavailable — it is not "low". A missing rain chance does
 * not count as zero.
 */
export function thunderRiskFromCape(
  capeJkg: number | null | undefined,
  rainChancePct: number | null | undefined,
): ThunderRisk | null {
  if (!finite(capeJkg)) return null;
  const rain = finite(rainChancePct) ? rainChancePct : null;
  if (capeJkg >= 1000 && rain != null && rain >= 20) return 'higher';
  if (capeJkg >= 800 && rain != null && rain >= 15) return 'possible';
  if (capeJkg >= 1000 && rain == null) return 'possible';
  if (capeJkg >= 500 && rain != null && rain >= 40) return 'possible';
  return 'low';
}

export function thunderGuestLabel(risk: ThunderRisk | null): string {
  if (risk === 'low') return 'Low';
  if (risk === 'possible') return 'Possible';
  if (risk === 'higher') return 'Higher';
  return '—';
}

export function rainLikelihoodWords(pct: number | null): string | null {
  if (!finite(pct)) return null;
  if (pct < 15) return 'Mostly dry';
  if (pct < 35) return 'A shower is possible';
  if (pct < 60) return 'Showers likely';
  return 'Rain likely';
}

export function showerShade(pct: number | null): ShowerShade {
  if (!finite(pct)) return 'unavailable';
  if (pct < 15) return 'dry';
  if (pct < 40) return 'possible';
  if (pct < 65) return 'likely';
  return 'heavy';
}

/**
 * Shade a shore from Spire's hourly rain rate. A returned 0 is dry.
 * A missing rate is unavailable — it is not copied from another shore
 * and it is not turned into a chance.
 */
export function rainRateShade(rateMmHr: number | null | undefined): ShowerShade {
  if (!finite(rateMmHr) || rateMmHr < 0) return 'unavailable';
  if (rateMmHr < 0.2) return 'dry';
  if (rateMmHr < 1) return 'possible';
  if (rateMmHr < 2.5) return 'likely';
  return 'heavy';
}

export function skyFromSignals(args: {
  rainChancePct: number | null;
  cloudCoverPct: number | null;
  thunderRisk: ThunderRisk | null;
}): SkyKind {
  const { rainChancePct: rain, cloudCoverPct: cloud, thunderRisk: thunder } = args;
  if (thunder === 'higher') return 'thunder';
  if (thunder === 'possible' && rain != null && rain >= 35) return 'thunder';
  if (rain != null && rain >= 40) return 'shower';
  if ((cloud != null && cloud >= 60) || (rain != null && rain >= 20)) return 'cloud';
  if (rain != null || cloud != null) return 'sun';
  return 'unavailable';
}

export function windGuestLabel(ms: number | null | undefined): string | null {
  if (!finite(ms) || ms < 0) return null;
  const rounded = Math.round(ms);
  if (ms < 1) return 'Calm';
  if (ms < 3) return `Light ${rounded} m/s`;
  if (ms < 6) return `Breezy ${rounded} m/s`;
  if (ms < 9) return `Fresh ${rounded} m/s`;
  return `Strong ${rounded} m/s`;
}

export function uvGuestLabel(uv: number | null | undefined): string | null {
  if (!finite(uv) || uv < 0) return null;
  const n = Math.round(uv);
  if (uv < 3) return `${n} low`;
  if (uv < 6) return `${n} moderate`;
  if (uv < 8) return `${n} high`;
  if (uv < 11) return `${n} very high`;
  return `${n} extreme`;
}

export function temperatureBiasByIctHour(pairs: TemperaturePair[]): HourBias[] {
  const grouped = new Map<number, number[]>();
  for (const pair of pairs) {
    if (!finite(pair.forecastTempC) || !finite(pair.stationTempC)) continue;
    const err = pair.forecastTempC - pair.stationTempC;
    if (Math.abs(err) > BIAS_MAX_ABS_ERROR_C) continue;
    const hour = ictHourFromUtc(pair.validTimeUtc);
    if (hour == null) continue;
    const list = grouped.get(hour) ?? [];
    list.push(err);
    grouped.set(hour, list);
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ictHour, errors]) => {
      const samples = errors.length;
      const biasC =
        samples >= BIAS_MIN_SAMPLES
          ? Math.round((errors.reduce((sum, v) => sum + v, 0) / samples) * 10) / 10
          : null;
      return { ictHour, samples, biasC };
    });
}

export function applyTemperatureBias(
  tempC: number | null | undefined,
  biasC: number | null | undefined,
): { tempC: number | null; corrected: boolean } {
  if (!finite(tempC)) return { tempC: null, corrected: false };
  if (!finite(biasC)) return { tempC, corrected: false };
  const next = Math.round((tempC - biasC) * 10) / 10;
  return { tempC: next, corrected: Math.abs(biasC) >= BIAS_VISIBLE_C };
}

export function pairsFromHours(
  forecast: Array<{ validTimeUtc: string; tempC: number | null }>,
  station: Array<{ hourUtc: string; tempC: number | null }>,
): TemperaturePair[] {
  const byHour = new Map<string, number>();
  for (const row of station) {
    if (!finite(row.tempC)) continue;
    const key = utcHourKey(row.hourUtc);
    if (key) byHour.set(key, row.tempC);
  }
  const out: TemperaturePair[] = [];
  for (const row of forecast) {
    if (!finite(row.tempC)) continue;
    const key = utcHourKey(row.validTimeUtc);
    if (!key || !byHour.has(key)) continue;
    out.push({
      validTimeUtc: row.validTimeUtc,
      forecastTempC: row.tempC,
      stationTempC: byHour.get(key)!,
    });
  }
  return out;
}

export function biasSummary(biases: HourBias[], read: 'ok' | 'unread' = 'ok'): string {
  if (read === 'unread') {
    return 'Temperatures are the forecast as issued. Garden readings could not be read.';
  }
  const mean = (rows: HourBias[]): number | null => {
    const vals = rows.map((r) => r.biasC).filter(finite);
    if (!vals.length) return null;
    return vals.reduce((sum, v) => sum + v, 0) / vals.length;
  };
  const morning = biases.filter((b) => b.ictHour >= 6 && b.ictHour < 10);
  const afternoon = biases.filter((b) => b.ictHour >= 12 && b.ictHour < 17);
  const morningMean = mean(morning);
  const afternoonMean = mean(afternoon);
  if (afternoonMean != null && afternoonMean <= -1 && morning.filter((b) => b.biasC != null).length >= 2) {
    if (morningMean != null && morningMean >= 0.8) {
      return 'Temperatures are adjusted: recent garden readings were cooler than the forecast early, and warmer in the afternoon.';
    }
  }
  if (afternoonMean != null && afternoonMean <= -1) {
    return 'Temperatures are adjusted: recent afternoon garden readings were warmer than the forecast.';
  }
  if (biases.some((b) => finite(b.biasC) && Math.abs(b.biasC) >= BIAS_VISIBLE_C)) {
    return 'Temperatures are adjusted using recent garden-station readings.';
  }
  if (!biases.some((b) => b.biasC != null)) {
    return 'Temperatures are the forecast as issued. Not enough recent garden hours to adjust them.';
  }
  return 'Temperatures are the forecast as issued. Recent garden readings were already close.';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function hourRange(start: number, end: number): string {
  return `${pad2(start)}:00–${pad2(end)}:00`;
}

function strongestThunder(risks: Array<ThunderRisk | null>): ThunderRisk | null {
  if (risks.includes('higher')) return 'higher';
  if (risks.includes('possible')) return 'possible';
  if (risks.includes('low')) return 'low';
  return null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function maxOrNull(values: number[]): number | null {
  if (!values.length) return null;
  return Math.max(...values);
}

export function formatBoardDate(dateYmd: string): string {
  const d = new Date(`${dateYmd}T12:00:00+07:00`);
  if (!Number.isFinite(d.getTime())) return dateYmd;
  return d.toLocaleDateString('en-GB', {
    timeZone: BOARD_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * Forecast run time in ICT. The date is added when the run was issued on another
 * ICT day than the board, so an older run is not read as this morning's.
 */
export function formatIssuedLabel(
  iso: string | null | undefined,
  boardDateYmd?: string | null,
): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const clock = d.toLocaleTimeString('en-GB', {
    timeZone: BOARD_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const issuedYmd = d.toLocaleDateString('en-CA', { timeZone: BOARD_TIME_ZONE });
  if (boardDateYmd && issuedYmd !== boardDateYmd) {
    const day = d.toLocaleDateString('en-GB', {
      timeZone: BOARD_TIME_ZONE,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    return `Issued ${day.replace(',', '')}, ${clock} ICT`;
  }
  return `Issued ${clock} ICT`;
}

type CorrectedHour = BoardHourInput & {
  ictHour: number;
  displayTempC: number | null;
  adjusted: boolean;
  thunderRisk: ThunderRisk | null;
};

function correctedHours(
  dateYmd: string,
  hours: BoardHourInput[],
  biasByHour: Map<number, number | null>,
): CorrectedHour[] {
  const out: CorrectedHour[] = [];
  for (const hour of hours) {
    if (ictDateKey(hour.timeUtc) !== dateYmd) continue;
    const ictHour = ictHourFromUtc(hour.timeUtc);
    if (ictHour == null || ictHour < BOARD_HOUR_START || ictHour >= BOARD_HOUR_END) continue;
    const rain = normalizeChancePercent(hour.rainChancePct);
    const cloud = normalizeCloudPercent(hour.cloudCoverPct);
    const applied = applyTemperatureBias(hour.tempC, biasByHour.get(ictHour));
    out.push({
      ...hour,
      rainChancePct: rain,
      cloudCoverPct: cloud,
      ictHour,
      displayTempC: applied.tempC,
      adjusted: applied.corrected,
      thunderRisk: thunderRiskFromCape(hour.capeJkg, rain),
    });
  }
  return out;
}

export function bestForToday(blocks: BoardBlockView[]): string {
  const byId = Object.fromEntries(blocks.map((b) => [b.id, b])) as Record<BoardBlockId, BoardBlockView>;
  const known = blocks.filter((b) => b.rainChancePct != null);
  if (known.length < 2) {
    return 'Best for today: unavailable until more of the day’s forecast is in.';
  }
  const ok = (b: BoardBlockView | undefined) =>
    !!b && b.rainChancePct != null && b.rainChancePct < 30 && b.thunderRisk !== 'higher';
  const wet = (b: BoardBlockView | undefined) =>
    !!b && b.rainChancePct != null && (b.rainChancePct >= 40 || b.thunderRisk === 'higher');
  const morning = byId.morning;
  const midday = byId.midday;
  const afternoon = byId.afternoon;
  const evening = byId.evening;
  const allWet =
    known.length >= 3 &&
    known.every((b) => b.rainChancePct != null && (b.rainChancePct >= 40 || b.thunderRisk === 'higher'));
  if (allWet) {
    return 'Best for today: covered plans — a market, a café, or an indoor afternoon.';
  }
  if (ok(morning) && wet(afternoon)) {
    if (afternoon?.thunderRisk === 'higher') {
      return 'Best for today: the beach in the morning. Keep the afternoon indoors if thunder builds.';
    }
    return 'Best for today: the beach in the morning, then a waterfall or the market once showers build.';
  }
  if (wet(morning) && ok(afternoon)) {
    return 'Best for today: a waterfall or the market this morning, and the beach once the afternoon dries out.';
  }
  const middayUvHigh = midday?.uvMax != null && midday.uvMax >= 8;
  if (ok(morning) && ok(midday) && ok(afternoon) && middayUvHigh) {
    return 'Best for today: the beach in the morning. Take shade over the midday sun, then the beach again later.';
  }
  if (ok(morning) && ok(midday) && ok(afternoon)) {
    if (ok(evening)) {
      return 'Best for today: the beach through the afternoon, and dinner outside this evening.';
    }
    return 'Best for today: the beach through the afternoon.';
  }
  if (ok(evening) && wet(morning) && wet(afternoon)) {
    return 'Best for today: covered plans during the day. The evening is the outdoor window.';
  }
  return 'Best for today: keep a flexible plan and a covered backup.';
}

function tempLabel(temps: number[]): string {
  const shown = temps.filter(finite).map((t) => Math.round(t));
  if (!shown.length) return '—';
  const lo = Math.min(...shown);
  const hi = Math.max(...shown);
  return lo === hi ? `${lo}°` : `${lo}–${hi}°`;
}

function regionsForSlice(
  dateYmd: string,
  startHour: number,
  endHour: number,
  rates: CoastRateHour[] | undefined,
  regionRead: 'live' | 'sample' | 'unread',
): BoardRegionView[] {
  return BOARD_REGIONS.map((id) => {
    if (regionRead === 'unread' || !rates) return { id, shade: 'unavailable' as const };
    const values: number[] = [];
    for (const row of rates) {
      if (row.region !== id) continue;
      if (ictDateKey(row.timeUtc) !== dateYmd) continue;
      const ictHour = ictHourFromUtc(row.timeUtc);
      if (ictHour == null || ictHour < startHour || ictHour >= endHour) continue;
      if (finite(row.rateMmHr) && row.rateMmHr >= 0) values.push(row.rateMmHr);
    }
    if (!values.length) return { id, shade: 'unavailable' as const };
    return { id, shade: rainRateShade(Math.max(...values)) };
  });
}

export function buildDailyBoard(args: {
  dateYmd: string;
  hours: BoardHourInput[];
  bias: HourBias[];
  mode: DailyBoardMode;
  issuedAtUtc?: string | null;
  /** 'unread' when the garden table could not be read. Empty pairs are a thin sample, not a failed read. */
  biasRead?: 'ok' | 'unread';
  regionRates?: CoastRateHour[];
  /** 'unread' leaves every shore grey. The island chance is not pasted on. */
  regionRead?: 'live' | 'sample' | 'unread';
}): DailyBoard {
  const regionRead = args.regionRead ?? 'unread';
  const biasByHour = new Map(args.bias.map((b) => [b.ictHour, b.biasC]));
  const corrected = correctedHours(args.dateYmd, args.hours, biasByHour);
  const byHour = new Map<number, CorrectedHour>();
  for (const hour of corrected) byHour.set(hour.ictHour, hour);

  const hours: BoardHourView[] = [];
  for (let ictHour = BOARD_HOUR_START; ictHour < BOARD_HOUR_END; ictHour++) {
    const hour = byHour.get(ictHour);
    if (!hour) {
      hours.push({
        ictHour,
        present: false,
        rainChancePct: null,
        rainLabel: '—',
        thunderRisk: null,
        thunderLabel: '—',
        uvLabel: '—',
        windLabel: '—',
        sky: 'unavailable',
      });
      continue;
    }
    const uv = uvGuestLabel(hour.uvIndex);
    const wind = windGuestLabel(hour.windMs);
    hours.push({
      ictHour,
      present: true,
      rainChancePct: hour.rainChancePct,
      rainLabel: hour.rainChancePct == null ? '—' : `${Math.round(hour.rainChancePct)}%`,
      thunderRisk: hour.thunderRisk,
      thunderLabel: thunderGuestLabel(hour.thunderRisk),
      uvLabel: uv ?? '—',
      windLabel: wind ?? '—',
      sky: skyFromSignals({
        rainChancePct: hour.rainChancePct,
        cloudCoverPct: hour.cloudCoverPct,
        thunderRisk: hour.thunderRisk,
      }),
    });
  }

  const blocks: BoardBlockView[] = BOARD_BLOCKS.map((spec) => {
    const slice = corrected.filter((h) => h.ictHour >= spec.startHour && h.ictHour < spec.endHour);
    const rains = slice.map((h) => h.rainChancePct).filter(finite);
    const clouds = slice.map((h) => h.cloudCoverPct).filter(finite);
    const uvs = slice.map((h) => h.uvIndex).filter(finite);
    const rainChancePct = maxOrNull(rains);
    const thunderRisk = strongestThunder(slice.map((h) => h.thunderRisk));
    const sky = slice.length
      ? skyFromSignals({
          rainChancePct,
          cloudCoverPct: mean(clouds),
          thunderRisk,
        })
      : 'unavailable';
    return {
      id: spec.id,
      label: spec.label,
      hourRange: hourRange(spec.startHour, spec.endHour),
      sky,
      tempLabel: tempLabel(slice.map((h) => h.displayTempC).filter(finite)),
      adjusted: slice.some((h) => h.adjusted),
      rainChancePct,
      rainWords: rainLikelihoodWords(rainChancePct),
      shade: showerShade(rainChancePct),
      regions: regionsForSlice(args.dateYmd, spec.startHour, spec.endHour, args.regionRates, regionRead),
      thunderRisk,
      uvMax: maxOrNull(uvs),
    };
  });

  return {
    mode: args.mode,
    dateYmd: args.dateYmd,
    dateLabel: formatBoardDate(args.dateYmd),
    issuedLabel: formatIssuedLabel(args.issuedAtUtc, args.dateYmd),
    blocks,
    hours,
    bestForToday: bestForToday(blocks),
    biasSummary: biasSummary(args.bias, args.biasRead ?? 'ok'),
    uvNote: uvSourceNote(
      corrected
        .filter((h) => h.ictHour >= BOARD_HOUR_START && h.ictHour < BOARD_HOUR_END && finite(h.uvIndex))
        .map((h) => h.uvSource),
    ),
    credit: CREDIT,
    mapCaption: mapCaption(regionRead),
  };
}
import { type BoardUvSource, uvSourceNote } from '@/lib/daily-board-uv';
