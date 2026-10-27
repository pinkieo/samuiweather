/**
 * Load the daily board for today from the same Spire merge as `/api/weather`
 * (point tiers, OPF rain chance, OpenUV index), laid over stored hours for
 * the part of the day the live feed has already dropped. A failed live read
 * keeps the stored rows. The daypart cards do not draw shore maps, so this
 * load does not request coast rain rates. Hours no UV source covers are
 * filled from Open-Meteo and labelled. No live radar.
 */

import { bucketStationHours, SPIRE_LOCATION_ID } from '@/lib/forecast-day-accuracy';
import {
  ECOWITT_LOCATION_ID,
  fetchEcowittRange,
  ictDayUtcRange,
  ictYmd,
  parseIctDateYmd,
} from '@/lib/ecowitt-data';
import { getSamuiForecastFeed, getSpireApiToken, type SamuiWeatherForecastRow } from '@/lib/spire';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  type BoardHourInput,
  type DailyBoard,
  type HourBias,
  BIAS_LOOKBACK_DAYS,
  buildDailyBoard,
  normalizeChancePercent,
  normalizeCloudPercent,
  pairsFromHours,
  temperatureBiasByIctHour,
  utcHourKey,
} from '@/lib/daily-board';
import { sampleDailyBoard } from '@/lib/daily-board-sample';
import { type BoardUvSource, fetchOpenMeteoUvHourMap, fillMissingUv } from '@/lib/daily-board-uv';

type ForecastTempRow = {
  valid_time_utc: string;
  issuance_time_utc: string | null;
  air_temperature_c: number | null;
};

type ForecastBoardRow = ForecastTempRow & {
  wind_speed_ms: number | null;
  total_cloud_cover: number | null;
  cape: number | null;
  probability_of_precipitation_1hr: number | null;
  uv_index: number | null;
  values_json: Record<string, unknown> | null;
};

const UV_KEYS = ['uv_index', 'ultraviolet_index', 'UV_index', 'surface_uv_index'] as const;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function uvFromRow(column: number | null, values: unknown): number | null {
  if (typeof column === 'number' && Number.isFinite(column) && column >= 0) return column;
  return uvFromValues(values);
}

function uvSourceFromValues(uv: number | null, values: unknown): BoardUvSource | null {
  if (uv == null) return null;
  const src = values && typeof values === 'object' ? (values as Record<string, unknown>).uv_index_source : null;
  return src === 'openuv' ? 'openuv' : 'spire';
}

function uvFromValues(values: unknown): number | null {
  if (!values || typeof values !== 'object') return null;
  const record = values as Record<string, unknown>;
  for (const key of UV_KEYS) {
    const value = num(record[key]);
    if (value != null && value >= 0) return value;
  }
  return null;
}

function cloudFromRow(total: number | null, values: unknown): number | null {
  const direct = normalizeCloudPercent(total);
  if (direct != null) return direct;
  if (!values || typeof values !== 'object') return null;
  const record = values as Record<string, unknown>;
  for (const key of ['total_cloud_cover', 'cloud_cover'] as const) {
    const value = normalizeCloudPercent(num(record[key]));
    if (value != null) return value;
  }
  return null;
}

function latestByHour<T extends ForecastTempRow>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = utcHourKey(row.valid_time_utc);
    if (!key) continue;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, row);
      continue;
    }
    const a = Date.parse(row.issuance_time_utc || '') || 0;
    const b = Date.parse(prev.issuance_time_utc || '') || 0;
    if (a >= b) best.set(key, row);
  }
  return [...best.values()];
}

async function fetchTable<T>(
  table: 'weather_history' | 'weather_forecast',
  select: string,
  startIso: string,
  endIso: string,
): Promise<T[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq('location_id', SPIRE_LOCATION_ID)
    .gte('valid_time_utc', startIso)
    .lt('valid_time_utc', endIso)
    .order('valid_time_utc', { ascending: true })
    .limit(1500);
  if (error) throw new Error(error.message);
  return (data || []) as T[];
}

/** Feed values are already percents (0–100), matching `/api/weather`. */
function alreadyPercent(raw: number | null | undefined): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 100) return null;
  return Math.round(raw * 10) / 10;
}

/**
 * One `/api/weather` hour → board hour. Rain and UV are the feed's numbers.
 * UV on that route is the OpenUV forecast (Spire's point bundles have no index).
 */
export function boardHourFromForecastRow(row: Pick<
  SamuiWeatherForecastRow,
  'time' | 'temp' | 'pop' | 'cloudCover' | 'cape' | 'windSpeed' | 'uvIndex'
>): BoardHourInput {
  const uv = num(row.uvIndex);
  return {
    timeUtc: row.time,
    tempC: num(row.temp),
    rainChancePct: alreadyPercent(row.pop),
    cloudCoverPct: alreadyPercent(row.cloudCover),
    capeJkg: num(row.cape),
    windMs: num(row.windSpeed),
    uvIndex: uv != null && uv >= 0 ? uv : null,
    uvSource: uv != null && uv >= 0 ? 'openuv' : null,
  };
}

function overlayHours(stored: BoardHourInput[], live: BoardHourInput[]): BoardHourInput[] {
  const byHour = new Map<string, BoardHourInput>();
  for (const hour of stored) {
    const key = utcHourKey(hour.timeUtc);
    if (key) byHour.set(key, hour);
  }
  for (const hour of live) {
    const key = utcHourKey(hour.timeUtc);
    if (key) byHour.set(key, hour);
  }
  return [...byHour.values()];
}

function newerIssuance(a: string | null | undefined, b: string | null | undefined): string | null {
  const at = a ? Date.parse(a) : NaN;
  const bt = b ? Date.parse(b) : NaN;
  if (!Number.isFinite(at) && !Number.isFinite(bt)) return null;
  if (!Number.isFinite(bt) || (Number.isFinite(at) && at >= bt)) return a ?? null;
  return b ?? null;
}

export type BoardLiveFeed = {
  hours: BoardHourInput[];
  issuedAtUtc: string | null;
};

async function loadDefaultFeed(): Promise<BoardLiveFeed | null> {
  if (!getSpireApiToken()) return null;
  try {
    const feed = await getSamuiForecastFeed(AbortSignal.timeout(20_000));
    if (!feed.rows.length) return null;
    return {
      hours: feed.rows.map(boardHourFromForecastRow),
      issuedAtUtc: feed.issuanceTimeUtc,
    };
  } catch (err) {
    console.error('[daily-board] live forecast failed', err instanceof Error ? err.message : err);
    return null;
  }
}

export function forecastRowToHour(row: ForecastBoardRow): BoardHourInput {
  return {
    timeUtc: row.valid_time_utc,
    tempC: num(row.air_temperature_c),
    rainChancePct: normalizeChancePercent(num(row.probability_of_precipitation_1hr)),
    cloudCoverPct: cloudFromRow(num(row.total_cloud_cover), row.values_json),
    capeJkg: num(row.cape),
    windMs: num(row.wind_speed_ms),
    uvIndex: uvFromRow(num(row.uv_index), row.values_json),
    uvSource: uvSourceFromValues(uvFromRow(num(row.uv_index), row.values_json), row.values_json),
  };
}

async function loadBias(
  boardStart: Date,
): Promise<{ bias: HourBias[]; biasRead: 'ok' | 'unread' }> {
  const lookbackStart = new Date(boardStart.getTime() - BIAS_LOOKBACK_DAYS * 86_400_000);
  const startIso = lookbackStart.toISOString();
  const endIso = boardStart.toISOString();
  const [history, current, station] = await Promise.all([
    fetchTable<ForecastTempRow>(
      'weather_history',
      'valid_time_utc,issuance_time_utc,air_temperature_c',
      startIso,
      endIso,
    ),
    fetchTable<ForecastTempRow>(
      'weather_forecast',
      'valid_time_utc,issuance_time_utc,air_temperature_c',
      startIso,
      endIso,
    ),
    fetchEcowittRange(lookbackStart, boardStart, ECOWITT_LOCATION_ID),
  ]);
  if (!station.ok) return { bias: [], biasRead: 'unread' };
  const forecast = latestByHour([...history, ...current]).map((row) => ({
    validTimeUtc: row.valid_time_utc,
    tempC: num(row.air_temperature_c),
  }));
  const stationHours = bucketStationHours(station.samples);
  return {
    bias: temperatureBiasByIctHour(pairsFromHours(forecast, stationHours)),
    biasRead: 'ok',
  };
}

function unavailable(dateYmd: string): DailyBoard {
  return buildDailyBoard({
    dateYmd,
    hours: [],
    bias: [],
    mode: 'unavailable',
  });
}

async function loadStoredRows(startIso: string, endIso: string): Promise<ForecastBoardRow[]> {
  if (!getSupabaseAdmin()) return [];
  const select =
    'valid_time_utc,issuance_time_utc,air_temperature_c,wind_speed_ms,total_cloud_cover,cape,probability_of_precipitation_1hr,uv_index,values_json';
  const [forecast, history] = await Promise.all([
    fetchTable<ForecastBoardRow>('weather_forecast', select, startIso, endIso),
    fetchTable<ForecastBoardRow>('weather_history', select, startIso, endIso),
  ]);
  return latestByHour([...forecast, ...history]);
}

export async function loadDailyBoard(opts?: {
  dateYmd?: string | null;
  sample?: boolean;
  now?: Date;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /**
   * Today's live Spire merge. Omit to read Spire the same way as `/api/weather`.
   * A function that returns null keeps the stored hours.
   */
  loadFeed?: () => Promise<BoardLiveFeed | null>;
}): Promise<DailyBoard> {
  const now = opts?.now ?? new Date();
  const dateYmd = parseIctDateYmd(opts?.dateYmd) ?? ictYmd(now);
  if (opts?.sample) return sampleDailyBoard(dateYmd);

  const range = ictDayUtcRange(dateYmd);
  if (!range) return unavailable(dateYmd);
  const today = ictYmd(now);
  const wantLive = dateYmd === today;

  try {
    const feedPromise = (async () => {
      if (!wantLive) return null;
      try {
        return opts?.loadFeed ? await opts.loadFeed() : await loadDefaultFeed();
      } catch (err) {
        console.error('[daily-board] live forecast failed', err instanceof Error ? err.message : err);
        return null;
      }
    })();
    const [feed, storedRows, biasResult] = await Promise.all([
      feedPromise,
      loadStoredRows(range.startUtc.toISOString(), range.endUtc.toISOString()).catch((err: unknown) => {
        console.error('[daily-board] forecast read failed', err instanceof Error ? err.message : err);
        return [] as ForecastBoardRow[];
      }),
      loadBias(range.startUtc).catch((err: unknown) => {
        console.error('[daily-board] bias read failed', err instanceof Error ? err.message : err);
        return { bias: [] as HourBias[], biasRead: 'unread' as const };
      }),
    ]);
    const storedHours = storedRows.map(forecastRowToHour);
    const liveHours = feed?.hours ?? [];
    let hours = liveHours.length ? overlayHours(storedHours, liveHours) : storedHours;
    if (!hours.length) return unavailable(dateYmd);
    const openMeteoUv = hours.some((h) => h.uvIndex == null)
      ? await fetchOpenMeteoUvHourMap(range.startUtc, range.endUtc, opts?.fetchImpl)
      : null;
    hours = fillMissingUv(hours, openMeteoUv);
    const storedIssued = storedRows
      .map((row) => row.issuance_time_utc)
      .filter((iso): iso is string => !!iso)
      .sort()
      .at(-1);
    const issued = liveHours.length ? newerIssuance(feed?.issuedAtUtc, storedIssued) : (storedIssued ?? null);
    return buildDailyBoard({
      dateYmd,
      hours,
      bias: biasResult.bias,
      biasRead: biasResult.biasRead,
      mode: 'live',
      issuedAtUtc: issued,
    });
  } catch (err) {
    console.error('[daily-board] forecast read failed', err instanceof Error ? err.message : err);
    return unavailable(dateYmd);
  }
}
