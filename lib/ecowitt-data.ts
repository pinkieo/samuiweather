import { createClient } from '@supabase/supabase-js';
import type { EcowittObservation } from '@/types/supabase';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const ECOWITT_LOCATION_ID = 'baan_ton_kluay';
export const ECOWITT_TIME_ZONE = 'Asia/Bangkok';
const DEFAULT_LOCATION_ID = ECOWITT_LOCATION_ID;
const ICT_YMD = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 1000;

type DbRow = {
  id: string;
  observed_at: string;
  location_id: string;
  station_type: string | null;
  station_id: string | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  indoor_temperature_c: number | null;
  indoor_humidity_pct: number | null;
  relative_pressure_hpa: number | null;
  absolute_pressure_hpa: number | null;
  wind_speed_ms: number | null;
  wind_gust_ms: number | null;
  wind_direction_deg: number | null;
  rain_rate_mmh: number | null;
  rain_hour_mm: number | null;
  rain_day_mm: number | null;
  rain_week_mm: number | null;
  rain_month_mm: number | null;
  rain_year_mm: number | null;
  rain_event_mm: number | null;
  solar_wm2: number | null;
  uv_index: number | null;
  lightning_distance_km: number | null;
  lightning_count: number | null;
  battery_status: Record<string, string> | null;
  raw_json: Record<string, string>;
  created_at: string;
};

function fromDbRow(row: DbRow): EcowittObservation {
  return {
    id: row.id,
    observedAt: row.observed_at,
    locationId: row.location_id,
    stationType: row.station_type,
    stationId: row.station_id,
    temperatureC: row.temperature_c,
    humidityPct: row.humidity_pct,
    indoorTemperatureC: row.indoor_temperature_c,
    indoorHumidityPct: row.indoor_humidity_pct,
    relativePressureHpa: row.relative_pressure_hpa,
    absolutePressureHpa: row.absolute_pressure_hpa,
    windSpeedMs: row.wind_speed_ms,
    windGustMs: row.wind_gust_ms,
    windDirectionDeg: row.wind_direction_deg,
    rainRateMmh: row.rain_rate_mmh,
    rainHourMm: row.rain_hour_mm,
    rainDayMm: row.rain_day_mm,
    rainWeekMm: row.rain_week_mm,
    rainMonthMm: row.rain_month_mm,
    rainYearMm: row.rain_year_mm,
    rainEventMm: row.rain_event_mm,
    solarWm2: row.solar_wm2,
    uvIndex: row.uv_index,
    lightningDistanceKm: row.lightning_distance_km,
    lightningCount: row.lightning_count,
    batteryStatus: row.battery_status,
    rawJson: row.raw_json,
    createdAt: row.created_at,
  };
}

export type FetchLatestEcowittResult =
  | { ok: true; observation: EcowittObservation }
  | { ok: false; error: string };

/** Latest ground-truth row for Baan Ton Kluay (server / service role only). */
export async function fetchLatestEcowittObservation(
  locationId = DEFAULT_LOCATION_ID,
): Promise<FetchLatestEcowittResult> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' };
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('ecowitt_observations')
    .select('*')
    .eq('location_id', locationId)
    .order('observed_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: false, error: 'No observations yet' };
  }

  return { ok: true, observation: fromDbRow(data as DbRow) };
}

export type EcowittDaySample = {
  observed_at: string;
  temperature_c: number | null;
  humidity_pct: number | null;
  wind_speed_ms: number | null;
  wind_gust_ms: number | null;
  rain_rate_mmh: number | null;
  rain_day_mm: number | null;
  solar_wm2: number | null;
  uv_index: number | null;
};

export type EcowittDailySummary = {
  available: boolean;
  date: string;
  timezone: typeof ECOWITT_TIME_ZONE;
  locationId: string;
  sampleCount: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
  humidityMinPct: number | null;
  humidityMaxPct: number | null;
  windMaxMs: number | null;
  windGustMaxMs: number | null;
  /** Peak of the station daily rain counter on that ICT day — not today's live counter. */
  rainDayMm: number | null;
  rainRateMaxMmh: number | null;
  solarMaxWm2: number | null;
  uvMax: number | null;
};

function finiteNums(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

function minNum(values: number[]): number | null {
  return values.length ? Math.min(...values) : null;
}

function maxNum(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

export function parseIctDateYmd(raw: string | null | undefined): string | null {
  const date = String(raw || '').trim();
  if (!ICT_YMD.test(date)) return null;
  const t = Date.parse(`${date}T12:00:00+07:00`);
  if (!Number.isFinite(t)) return null;
  return date;
}

/** ICT calendar day → exclusive UTC range. Asia/Bangkok is UTC+7, no DST. */
export function ictDayUtcRange(dateYmd: string): { startUtc: Date; endUtc: Date } | null {
  const date = parseIctDateYmd(dateYmd);
  if (!date) return null;
  const startUtc = new Date(`${date}T00:00:00+07:00`);
  if (!Number.isFinite(startUtc.getTime())) return null;
  return { startUtc, endUtc: new Date(startUtc.getTime() + 24 * 60 * 60 * 1000) };
}

export function ictYmd(at = new Date()): string {
  return at.toLocaleDateString('en-CA', {
    timeZone: ECOWITT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function yesterdayIctDate(at = new Date()): string {
  const today = ictYmd(at);
  const noon = new Date(`${today}T12:00:00+07:00`);
  return ictYmd(new Date(noon.getTime() - 24 * 60 * 60 * 1000));
}

export function summarizeEcowittDay(
  rows: EcowittDaySample[],
  date: string,
  locationId = DEFAULT_LOCATION_ID,
): EcowittDailySummary {
  const empty: EcowittDailySummary = {
    available: false,
    date,
    timezone: ECOWITT_TIME_ZONE,
    locationId,
    sampleCount: 0,
    firstObservedAt: null,
    lastObservedAt: null,
    temperatureMinC: null,
    temperatureMaxC: null,
    humidityMinPct: null,
    humidityMaxPct: null,
    windMaxMs: null,
    windGustMaxMs: null,
    rainDayMm: null,
    rainRateMaxMmh: null,
    solarMaxWm2: null,
    uvMax: null,
  };
  if (!rows.length) return empty;
  const ordered = [...rows].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const temps = finiteNums(ordered.map((r) => r.temperature_c));
  const hums = finiteNums(ordered.map((r) => r.humidity_pct));
  return {
    available: true,
    date,
    timezone: ECOWITT_TIME_ZONE,
    locationId,
    sampleCount: ordered.length,
    firstObservedAt: ordered[0]!.observed_at,
    lastObservedAt: ordered[ordered.length - 1]!.observed_at,
    temperatureMinC: minNum(temps),
    temperatureMaxC: maxNum(temps),
    humidityMinPct: minNum(hums),
    humidityMaxPct: maxNum(hums),
    windMaxMs: maxNum(finiteNums(ordered.map((r) => r.wind_speed_ms))),
    windGustMaxMs: maxNum(finiteNums(ordered.map((r) => r.wind_gust_ms))),
    rainDayMm: maxNum(finiteNums(ordered.map((r) => r.rain_day_mm))),
    rainRateMaxMmh: maxNum(finiteNums(ordered.map((r) => r.rain_rate_mmh))),
    solarMaxWm2: maxNum(finiteNums(ordered.map((r) => r.solar_wm2))),
    uvMax: maxNum(finiteNums(ordered.map((r) => r.uv_index))),
  };
}

export type FetchEcowittDailyResult =
  | { ok: true; summary: EcowittDailySummary; samples: EcowittDaySample[] }
  | { ok: false; error: string };

export async function fetchEcowittRange(
  startUtc: Date,
  endUtc: Date,
  locationId = DEFAULT_LOCATION_ID,
): Promise<{ ok: true; samples: EcowittDaySample[] } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' };
  }
  const samples: EcowittDaySample[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('ecowitt_observations')
      .select(
        'observed_at,temperature_c,humidity_pct,wind_speed_ms,wind_gust_ms,rain_rate_mmh,rain_day_mm,solar_wm2,uv_index',
      )
      .eq('location_id', locationId)
      .gte('observed_at', startUtc.toISOString())
      .lt('observed_at', endUtc.toISOString())
      .order('observed_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, error: error.message };
    const chunk = (data || []) as EcowittDaySample[];
    samples.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
    if (from > 20_000) break;
  }
  return { ok: true, samples };
}

export async function fetchEcowittDaily(
  dateYmd: string,
  locationId = DEFAULT_LOCATION_ID,
): Promise<FetchEcowittDailyResult> {
  const range = ictDayUtcRange(dateYmd);
  if (!range) return { ok: false, error: 'date must be YYYY-MM-DD (ICT)' };
  const window = await fetchEcowittRange(range.startUtc, range.endUtc, locationId);
  if (!window.ok) return window;
  return {
    ok: true,
    summary: summarizeEcowittDay(window.samples, dateYmd, locationId),
    samples: window.samples,
  };
}
