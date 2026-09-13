import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  type EcowittDailySummary,
  type EcowittDaySample,
  ictDayUtcRange,
} from '@/lib/ecowitt-data';

export const SPIRE_LOCATION_ID = 'samui_opf_hybrid';

export type StationHour = {
  hourUtc: string;
  tempC: number | null;
  humidityPct: number | null;
  windMs: number | null;
  rainRateMmh: number | null;
};

export type ForecastHour = {
  validTimeUtc: string;
  issuedAtUtc: string | null;
  tempC: number | null;
  humidityPct: number | null;
  windMs: number | null;
  precipRate: number | null;
  pop1h: number | null;
};

export type ForecastDayAccuracy = {
  hoursPaired: number;
  tempMaeC: number | null;
  tempBiasC: number | null;
  tempMinErrorC: number | null;
  tempMaxErrorC: number | null;
  humidityMaePct: number | null;
  windMaeMs: number | null;
  rainErrorMm: number | null;
  rainYesNoMatch: boolean | null;
  stationRainDayMm: number | null;
  forecastRainSumMm: number | null;
  stationWet: boolean | null;
  forecastWet: boolean | null;
};

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function finite(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function round3(v: number | null): number | null {
  return v == null ? null : Math.round(v * 1000) / 1000;
}

function hourKey(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(Math.floor(t / 3_600_000) * 3_600_000);
  return d.toISOString();
}

function avg(values: number[]): number | null {
  return mean(values);
}

export function bucketStationHours(rows: EcowittDaySample[]): StationHour[] {
  const buckets = new Map<string, EcowittDaySample[]>();
  for (const row of rows) {
    const key = hourKey(row.observed_at);
    if (!key) continue;
    const list = buckets.get(key) || [];
    list.push(row);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hourUtc, list]) => ({
      hourUtc,
      tempC: avg(list.map((r) => r.temperature_c).filter(finite)),
      humidityPct: avg(list.map((r) => r.humidity_pct).filter(finite)),
      windMs: avg(list.map((r) => r.wind_speed_ms).filter(finite)),
      rainRateMmh: avg(list.map((r) => r.rain_rate_mmh).filter(finite)),
    }));
}

export function scoreForecastDay(
  station: EcowittDailySummary,
  stationHours: StationHour[],
  forecastHours: ForecastHour[],
): ForecastDayAccuracy {
  const byHour = new Map(forecastHours.map((h) => [hourKey(h.validTimeUtc), h]));
  const tempErr: number[] = [];
  const humErr: number[] = [];
  const windErr: number[] = [];
  let hoursPaired = 0;
  for (const hour of stationHours) {
    const fc = byHour.get(hour.hourUtc);
    if (!fc) continue;
    hoursPaired += 1;
    if (finite(hour.tempC) && finite(fc.tempC)) tempErr.push(fc.tempC - hour.tempC);
    if (finite(hour.humidityPct) && finite(fc.humidityPct)) {
      humErr.push(fc.humidityPct - hour.humidityPct);
    }
    if (finite(hour.windMs) && finite(fc.windMs)) windErr.push(fc.windMs - hour.windMs);
  }

  const forecastTemps = forecastHours.map((h) => h.tempC).filter(finite);
  const forecastRain = forecastHours.map((h) => h.precipRate).filter(finite);
  const rainSum = forecastRain.length ? forecastRain.reduce((s, v) => s + v, 0) : null;
  const stationRain = station.rainDayMm;
  const stationWet = stationRain == null ? null : stationRain >= 0.2;
  const forecastWet = rainSum == null ? null : rainSum >= 0.2;
  const fcMin = forecastTemps.length ? Math.min(...forecastTemps) : null;
  const fcMax = forecastTemps.length ? Math.max(...forecastTemps) : null;

  return {
    hoursPaired,
    tempMaeC: round3(mean(tempErr.map((v) => Math.abs(v)))),
    tempBiasC: round3(mean(tempErr)),
    tempMinErrorC:
      fcMin != null && station.temperatureMinC != null
        ? round3(fcMin - station.temperatureMinC)
        : null,
    tempMaxErrorC:
      fcMax != null && station.temperatureMaxC != null
        ? round3(fcMax - station.temperatureMaxC)
        : null,
    humidityMaePct: round3(mean(humErr.map((v) => Math.abs(v)))),
    windMaeMs: round3(mean(windErr.map((v) => Math.abs(v)))),
    rainErrorMm:
      rainSum != null && stationRain != null ? round3(rainSum - stationRain) : null,
    rainYesNoMatch:
      stationWet == null || forecastWet == null ? null : stationWet === forecastWet,
    stationRainDayMm: stationRain,
    forecastRainSumMm: round3(rainSum),
    stationWet,
    forecastWet,
  };
}

type SpireRow = {
  valid_time_utc: string;
  issuance_time_utc: string | null;
  air_temperature_c: number | null;
  relative_humidity: number | null;
  wind_speed_ms: number | null;
  precipitation_rate: number | null;
  probability_of_precipitation_1hr: number | null;
};

function toForecastHour(row: SpireRow): ForecastHour {
  return {
    validTimeUtc: row.valid_time_utc,
    issuedAtUtc: row.issuance_time_utc,
    tempC: row.air_temperature_c,
    humidityPct: row.relative_humidity,
    windMs: row.wind_speed_ms,
    precipRate: row.precipitation_rate,
    pop1h: row.probability_of_precipitation_1hr,
  };
}

function latestIssuance(rows: SpireRow[]): ForecastHour[] {
  const best = new Map<string, SpireRow>();
  for (const row of rows) {
    const key = hourKey(row.valid_time_utc);
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
  return [...best.values()].map(toForecastHour);
}

async function fetchTable(
  table: 'weather_history' | 'weather_forecast',
  locationId: string,
  startIso: string,
  endIso: string,
): Promise<SpireRow[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(table)
    .select(
      'valid_time_utc,issuance_time_utc,air_temperature_c,relative_humidity,wind_speed_ms,precipitation_rate,probability_of_precipitation_1hr',
    )
    .eq('location_id', locationId)
    .gte('valid_time_utc', startIso)
    .lt('valid_time_utc', endIso)
    .order('valid_time_utc', { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data || []) as SpireRow[];
}

export async function fetchSpireHoursForIctDay(
  dateYmd: string,
  locationId = SPIRE_LOCATION_ID,
): Promise<{ ok: true; hours: ForecastHour[] } | { ok: false; error: string }> {
  const range = ictDayUtcRange(dateYmd);
  if (!range) return { ok: false, error: 'date must be YYYY-MM-DD (ICT)' };
  if (!getSupabaseAdmin()) {
    return { ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' };
  }
  try {
    const start = range.startUtc.toISOString();
    const end = range.endUtc.toISOString();
    const [history, current] = await Promise.all([
      fetchTable('weather_history', locationId, start, end),
      fetchTable('weather_forecast', locationId, start, end),
    ]);
    return { ok: true, hours: latestIssuance([...history, ...current]) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'forecast read failed' };
  }
}
