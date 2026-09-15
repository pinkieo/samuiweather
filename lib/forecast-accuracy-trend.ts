import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  ECOWITT_LOCATION_ID,
  type EcowittDaySample,
  ictDayUtcRange,
  ictYmd,
  parseIctDateYmd,
  summarizeEcowittDay,
} from '@/lib/ecowitt-data';
import {
  SPIRE_LOCATION_ID,
  type ForecastDayAccuracy,
  type ForecastHour,
  bucketStationHours,
  scoreForecastDay,
} from '@/lib/forecast-day-accuracy';

const PAGE = 1000;

export type TrendDay = {
  date: string;
  sampleCount: number;
  forecastHours: number;
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
  rainDayMm: number | null;
  score: ForecastDayAccuracy | null;
};

export type ForecastAccuracyTrend = {
  from: string;
  to: string;
  timezone: 'Asia/Bangkok';
  daysScored: number;
  daysMissingStation: number;
  daysMissingForecast: number;
  tempMaeC: number | null;
  tempBiasC: number | null;
  rainMaeMm: number | null;
  rainBiasMm: number | null;
  rainYesNoPct: number | null;
  windMaeMs: number | null;
  humidityMaePct: number | null;
  days: TrendDay[];
};

type SpireRow = {
  valid_time_utc: string;
  issuance_time_utc: string | null;
  air_temperature_c: number | null;
  relative_humidity: number | null;
  wind_speed_ms: number | null;
  precipitation_rate: number | null;
  probability_of_precipitation_1hr: number | null;
};

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 1000) / 1000;
}

function hourKey(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(Math.floor(t / 3_600_000) * 3_600_000).toISOString();
}

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

export function eachIctDay(from: string, to: string): string[] {
  const start = Date.parse(`${from}T12:00:00+07:00`);
  const end = Date.parse(`${to}T12:00:00+07:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const out: string[] = [];
  for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
    out.push(ictYmd(new Date(t)));
  }
  return out;
}

type Page<T> = { data: T[] | null; error: { message: string } | null };

async function fetchPages<T>(
  run: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await run(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
    if (offset > 500_000) break;
  }
  return rows;
}

export async function scoreForecastTrend(
  fromYmd: string,
  toYmd: string,
): Promise<({ ok: true } & ForecastAccuracyTrend) | { ok: false; error: string }> {
  const from = parseIctDateYmd(fromYmd);
  const to = parseIctDateYmd(toYmd);
  if (!from || !to) return { ok: false, error: 'from and to must be YYYY-MM-DD (ICT)' };
  const startRange = ictDayUtcRange(from);
  const endRange = ictDayUtcRange(to);
  if (!startRange || !endRange) return { ok: false, error: 'from and to must be YYYY-MM-DD (ICT)' };
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' };
  }

  const startIso = startRange.startUtc.toISOString();
  const endIso = endRange.endUtc.toISOString();
  const select =
    'valid_time_utc,issuance_time_utc,air_temperature_c,relative_humidity,wind_speed_ms,precipitation_rate,probability_of_precipitation_1hr';

  try {
    const [history, current, eco] = await Promise.all([
      fetchPages<SpireRow>((a, b) =>
        supabase
          .from('weather_history')
          .select(select)
          .eq('location_id', SPIRE_LOCATION_ID)
          .gte('valid_time_utc', startIso)
          .lt('valid_time_utc', endIso)
          .order('valid_time_utc', { ascending: true })
          .range(a, b),
      ),
      fetchPages<SpireRow>((a, b) =>
        supabase
          .from('weather_forecast')
          .select(select)
          .eq('location_id', SPIRE_LOCATION_ID)
          .gte('valid_time_utc', startIso)
          .lt('valid_time_utc', endIso)
          .order('valid_time_utc', { ascending: true })
          .range(a, b),
      ),
      fetchPages<EcowittDaySample>((a, b) =>
        supabase
          .from('ecowitt_observations')
          .select(
            'observed_at,temperature_c,humidity_pct,wind_speed_ms,wind_gust_ms,rain_rate_mmh,rain_day_mm,solar_wm2,uv_index',
          )
          .eq('location_id', ECOWITT_LOCATION_ID)
          .gte('observed_at', startIso)
          .lt('observed_at', endIso)
          .order('observed_at', { ascending: true })
          .range(a, b),
      ),
    ]);

    const forecastHours = latestIssuance([...history, ...current]);
    const ecoByDay = new Map<string, EcowittDaySample[]>();
    for (const row of eco) {
      const day = ictYmd(new Date(row.observed_at));
      const list = ecoByDay.get(day) || [];
      list.push(row);
      ecoByDay.set(day, list);
    }
    const fcByDay = new Map<string, ForecastHour[]>();
    for (const hour of forecastHours) {
      const day = ictYmd(new Date(hour.validTimeUtc));
      const list = fcByDay.get(day) || [];
      list.push(hour);
      fcByDay.set(day, list);
    }

    const days: TrendDay[] = [];
    let missingStation = 0;
    let missingForecast = 0;
    const tempMae: number[] = [];
    const tempBias: number[] = [];
    const rainAbs: number[] = [];
    const rainBias: number[] = [];
    const rainMatch: number[] = [];
    const windMae: number[] = [];
    const humMae: number[] = [];

    for (const date of eachIctDay(from, to)) {
      const samples = ecoByDay.get(date) || [];
      const hours = fcByDay.get(date) || [];
      if (!samples.length) missingStation += 1;
      if (!hours.length) missingForecast += 1;
      const station = summarizeEcowittDay(samples, date);
      const score =
        station.available && hours.length
          ? scoreForecastDay(station, bucketStationHours(samples), hours)
          : null;
      if (score) {
        if (score.tempMaeC != null) tempMae.push(score.tempMaeC);
        if (score.tempBiasC != null) tempBias.push(score.tempBiasC);
        if (score.rainErrorMm != null) {
          rainAbs.push(Math.abs(score.rainErrorMm));
          rainBias.push(score.rainErrorMm);
        }
        if (score.rainYesNoMatch != null) rainMatch.push(score.rainYesNoMatch ? 1 : 0);
        if (score.windMaeMs != null) windMae.push(score.windMaeMs);
        if (score.humidityMaePct != null) humMae.push(score.humidityMaePct);
      }
      days.push({
        date,
        sampleCount: station.sampleCount,
        forecastHours: hours.length,
        temperatureMinC: station.temperatureMinC,
        temperatureMaxC: station.temperatureMaxC,
        rainDayMm: station.rainDayMm,
        score,
      });
    }

    const scored = days.filter((d) => d.score && d.score.hoursPaired > 0).length;
    return {
      ok: true,
      from,
      to,
      timezone: 'Asia/Bangkok',
      daysScored: scored,
      daysMissingStation: missingStation,
      daysMissingForecast: missingForecast,
      tempMaeC: mean(tempMae),
      tempBiasC: mean(tempBias),
      rainMaeMm: mean(rainAbs),
      rainBiasMm: mean(rainBias),
      rainYesNoPct: mean(rainMatch) == null ? null : Math.round(mean(rainMatch)! * 1000) / 10,
      windMaeMs: mean(windMae),
      humidityMaePct: mean(humMae),
      days,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'trend failed' };
  }
}
