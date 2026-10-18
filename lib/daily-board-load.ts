/**
 * Load the daily board from stored Spire hours and recent Ecowitt temperatures.
 * Coast shading is a separate live Spire point read and is not stored.
 * Does not call Open-Meteo or live radar.
 */

import { bucketStationHours, SPIRE_LOCATION_ID } from '@/lib/forecast-day-accuracy';
import {
  ECOWITT_LOCATION_ID,
  fetchEcowittRange,
  ictDayUtcRange,
  ictYmd,
  parseIctDateYmd,
} from '@/lib/ecowitt-data';
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
import { loadCoastRainRates } from '@/lib/daily-board-coasts';
import { sampleDailyBoard } from '@/lib/daily-board-sample';

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

export function forecastRowToHour(row: ForecastBoardRow): BoardHourInput {
  return {
    timeUtc: row.valid_time_utc,
    tempC: num(row.air_temperature_c),
    rainChancePct: normalizeChancePercent(num(row.probability_of_precipitation_1hr)),
    cloudCoverPct: cloudFromRow(num(row.total_cloud_cover), row.values_json),
    capeJkg: num(row.cape),
    windMs: num(row.wind_speed_ms),
    uvIndex: uvFromRow(num(row.uv_index), row.values_json),
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

export async function loadDailyBoard(opts?: {
  dateYmd?: string | null;
  sample?: boolean;
  now?: Date;
}): Promise<DailyBoard> {
  const now = opts?.now ?? new Date();
  const dateYmd = parseIctDateYmd(opts?.dateYmd) ?? ictYmd(now);
  if (opts?.sample) return sampleDailyBoard(dateYmd);
  if (!getSupabaseAdmin()) return unavailable(dateYmd);

  const range = ictDayUtcRange(dateYmd);
  if (!range) return unavailable(dateYmd);

  try {
    const rows = latestByHour(
      (
        await Promise.all([
          fetchTable<ForecastBoardRow>(
            'weather_forecast',
            'valid_time_utc,issuance_time_utc,air_temperature_c,wind_speed_ms,total_cloud_cover,cape,probability_of_precipitation_1hr,uv_index,values_json',
            range.startUtc.toISOString(),
            range.endUtc.toISOString(),
          ),
          fetchTable<ForecastBoardRow>(
            'weather_history',
            'valid_time_utc,issuance_time_utc,air_temperature_c,wind_speed_ms,total_cloud_cover,cape,probability_of_precipitation_1hr,uv_index,values_json',
            range.startUtc.toISOString(),
            range.endUtc.toISOString(),
          ),
        ])
      ).flat(),
    );
    if (!rows.length) return unavailable(dateYmd);
    const [biasResult, coasts] = await Promise.all([
      loadBias(range.startUtc).catch((err: unknown) => {
        console.error('[daily-board] bias read failed', err instanceof Error ? err.message : err);
        return { bias: [] as HourBias[], biasRead: 'unread' as const };
      }),
      loadCoastRainRates(range.endUtc, now),
    ]);
    const issued = rows
      .map((row) => row.issuance_time_utc)
      .filter((iso): iso is string => !!iso)
      .sort()
      .at(-1);
    return buildDailyBoard({
      dateYmd,
      hours: rows.map(forecastRowToHour),
      bias: biasResult.bias,
      biasRead: biasResult.biasRead,
      mode: 'live',
      issuedAtUtc: issued ?? null,
      regionRates: coasts.rates,
      regionRead: coasts.status,
    });
  } catch (err) {
    console.error('[daily-board] forecast read failed', err instanceof Error ? err.message : err);
    return unavailable(dateYmd);
  }
}
