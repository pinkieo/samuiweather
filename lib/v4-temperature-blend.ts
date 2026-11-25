/**
 * Live + on-the-fly Samui v4 temperature blend enrichment for `/api/weather`.
 *
 * Strictly read-only: reads `ecowitt_observations`, `weather_forecast_snapshot`,
 * `weather_forecast`, and `weather_history` from Supabase, plus Open-Meteo
 * `ecmwf_ifs025` (current forecast and `previous-runs-api` trailing window).
 * Never writes to Supabase and never alters raw Spire `temp` or rain fields.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { ictDayUtcRange, ictYmd } from '@/lib/ecowitt-data';
import { combinedSignal } from '@/lib/promise-timeout';
import { SAMUI_CENTER, type SamuiWeatherForecastRow } from '@/lib/spire';
import {
  V4_BIAS_WINDOW_DAYS,
  V4_BLEND_MODEL_ID,
  canonicalUtcHourIso,
  computeBlendDailyEntry,
  computeHourlyBlendTemp,
  computeTrailingBiases,
  ictDateFromUtcIso,
  ictHourFromUtcIso,
  isEcowittTempDayValid,
  parseUtcMs,
  type HistoricalTempPair,
  type V4DailyTempForecast,
  type V4TemperatureBlendSummary,
  type V4TrailingBiases,
} from '@/lib/v4-temperature-blend-math';

const SPIRE_LOCATION_ID = 'samui_opf_hybrid';
const ECOWITT_LOCATION_ID = 'baan_ton_kluay';
const LOOKBACK_DAYS = 36;
const BIAS_CACHE_TTL_MS = 30 * 60 * 1000;
const ECMWF_LIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const BLEND_TIMEOUT_MS = 12_000;

let cachedBiases: {
  dateIct: string;
  expiresAt: number;
  biases: V4TrailingBiases;
} | null = null;

let cachedEcmwfLive: {
  expiresAt: number;
  hoursByUtcIso: Map<string, number>;
  elevationM: number | null;
} | null = null;

function addDaysYmd(ymd: string, deltaDays: number): string {
  const ms = Date.parse(`${ymd}T12:00:00+07:00`);
  return ictYmd(new Date(ms + deltaDays * 86_400_000));
}

function parseOpenMeteoHourlyGmt(payload: unknown): {
  hoursByUtcIso: Map<string, number>;
  elevationM: number | null;
} {
  const obj = payload as {
    elevation?: unknown;
    hourly?: { time?: unknown; temperature_2m?: unknown };
  } | null;
  const map = new Map<string, number>();
  const elev =
    typeof obj?.elevation === 'number' && Number.isFinite(obj.elevation)
      ? obj.elevation
      : null;
  const times = obj?.hourly?.time;
  const temps = obj?.hourly?.temperature_2m;
  if (!Array.isArray(times) || !Array.isArray(temps)) {
    return { hoursByUtcIso: map, elevationM: elev };
  }
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const v = temps[i];
    if (typeof t !== 'string' || typeof v !== 'number' || !Number.isFinite(v)) continue;
    const key = canonicalUtcHourIso(t);
    if (key) map.set(key, v);
  }
  return { hoursByUtcIso: map, elevationM: elev };
}

function parseOpenMeteoPrevDay1Ict(payload: unknown): Map<string, { hiC: number; loC: number }> {
  const obj = payload as {
    hourly?: { time?: unknown; temperature_2m_previous_day1?: unknown };
  } | null;
  const byDay = new Map<string, number[]>();
  const times = obj?.hourly?.time;
  const temps = obj?.hourly?.temperature_2m_previous_day1;
  if (!Array.isArray(times) || !Array.isArray(temps)) return new Map();

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const v = temps[i];
    if (typeof t !== 'string' || typeof v !== 'number' || !Number.isFinite(v)) continue;
    const day = t.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const list = byDay.get(day) ?? [];
    list.push(v);
    byDay.set(day, list);
  }

  const out = new Map<string, { hiC: number; loC: number }>();
  for (const [day, vals] of byDay.entries()) {
    if (vals.length === 24) {
      out.set(day, { hiC: Math.max(...vals), loC: Math.min(...vals) });
    }
  }
  return out;
}

async function fetchEcmwfLive(signal?: AbortSignal): Promise<{
  hoursByUtcIso: Map<string, number>;
  elevationM: number | null;
}> {
  if (cachedEcmwfLive && Date.now() < cachedEcmwfLive.expiresAt) {
    return {
      hoursByUtcIso: cachedEcmwfLive.hoursByUtcIso,
      elevationM: cachedEcmwfLive.elevationM,
    };
  }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${SAMUI_CENTER.lat}&longitude=${SAMUI_CENTER.lon}` +
    `&hourly=temperature_2m&models=ecmwf_ifs025&timezone=GMT&past_days=1&forecast_days=10`;
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) {
    throw new Error(`Open-Meteo ECMWF forecast HTTP ${res.status}`);
  }
  const parsed = parseOpenMeteoHourlyGmt(await res.json());
  cachedEcmwfLive = {
    expiresAt: Date.now() + ECMWF_LIVE_CACHE_TTL_MS,
    hoursByUtcIso: parsed.hoursByUtcIso,
    elevationM: parsed.elevationM,
  };
  return parsed;
}

async function fetchEcmwfPrevDay1(
  signal?: AbortSignal,
): Promise<Map<string, { hiC: number; loC: number }>> {
  const url =
    `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${SAMUI_CENTER.lat}&longitude=${SAMUI_CENTER.lon}` +
    `&hourly=temperature_2m_previous_day1&models=ecmwf_ifs025&timezone=Asia%2FBangkok&past_days=${LOOKBACK_DAYS + 2}&forecast_days=1`;
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) {
    throw new Error(`Open-Meteo previous-runs HTTP ${res.status}`);
  }
  return parseOpenMeteoPrevDay1Ict(await res.json());
}

async function fetchSpireHistoricalDayAhead(
  candidateDaysIct: string[],
): Promise<Map<string, { hiC: number; loC: number }>> {
  const sb = getSupabaseAdmin();
  if (!sb || candidateDaysIct.length === 0) return new Map();

  const issuanceIsos = candidateDaysIct.map((d) => `${addDaysYmd(d, -1)}T12:00:00Z`);
  type SnapRow = {
    issuance_time_utc: string | null;
    valid_time_utc: string | null;
    air_temperature_c: number | null;
  };
  const allRows: SnapRow[] = [];
  for (let offset = 0; offset < 3000; offset += 1000) {
    const { data, error } = await sb
      .from('weather_forecast_snapshot')
      .select('issuance_time_utc,valid_time_utc,air_temperature_c')
      .eq('location_id', SPIRE_LOCATION_ID)
      .in('issuance_time_utc', issuanceIsos)
      .gte('forecast_lead_hours', 4)
      .lte('forecast_lead_hours', 29)
      .range(offset, offset + 999);
    if (error || !data?.length) break;
    allRows.push(...(data as SnapRow[]));
    if (data.length < 1000) break;
  }

  const grouped = new Map<string, Array<{ validTimeUtc: string; tempC: number }>>();

  for (const row of allRows) {
    if (
      !row.issuance_time_utc ||
      !row.valid_time_utc ||
      typeof row.air_temperature_c !== 'number' ||
      !Number.isFinite(row.air_temperature_c)
    ) {
      continue;
    }
    const issMs = parseUtcMs(row.issuance_time_utc);
    if (issMs === null) continue;
    const issDateUtc = new Date(issMs).toISOString().slice(0, 10);
    const targetDayIct = addDaysYmd(issDateUtc, 1);
    const validDayIct = ictDateFromUtcIso(row.valid_time_utc);
    if (validDayIct !== targetDayIct) continue;
    const list = grouped.get(targetDayIct) ?? [];
    list.push({ validTimeUtc: row.valid_time_utc, tempC: row.air_temperature_c });
    grouped.set(targetDayIct, list);
  }

  const out = new Map<string, { hiC: number; loC: number }>();
  for (const [day, rows] of grouped.entries()) {
    const byHour = new Map<string, number>();
    for (const r of rows) {
      const k = canonicalUtcHourIso(r.validTimeUtc);
      if (k && !byHour.has(k)) byHour.set(k, r.tempC);
    }
    if (byHour.size < 24) continue;
    const daytime: number[] = [];
    const all: number[] = [];
    for (const [k, tempC] of byHour.entries()) {
      all.push(tempC);
      const hr = ictHourFromUtcIso(k);
      if (hr !== null && hr >= 10 && hr <= 17) daytime.push(tempC);
    }
    if (daytime.length > 0 && all.length > 0) {
      out.set(day, { hiC: Math.max(...daytime), loC: Math.min(...all) });
    }
  }
  return out;
}

async function fetchEcowittDayTempSummary(
  dateIct: string,
): Promise<{ obsHiC: number; obsLoC: number } | null> {
  const sb = getSupabaseAdmin();
  const range = ictDayUtcRange(dateIct);
  if (!sb || !range) return null;

  const startIso = range.startUtc.toISOString();
  const endIso = range.endUtc.toISOString();
  const dayStartMs = range.startUtc.getTime();

  const p1 = await sb
    .from('ecowitt_observations')
    .select('observed_at,temperature_c')
    .eq('location_id', ECOWITT_LOCATION_ID)
    .gte('observed_at', startIso)
    .lt('observed_at', endIso)
    .order('observed_at', { ascending: true })
    .range(0, 999);
  if (p1.error || !p1.data?.length) return null;

  const rows = [...p1.data] as Array<{ observed_at: string; temperature_c: number | null }>;
  if (p1.data.length === 1000) {
    const p2 = await sb
      .from('ecowitt_observations')
      .select('observed_at,temperature_c')
      .eq('location_id', ECOWITT_LOCATION_ID)
      .gte('observed_at', startIso)
      .lt('observed_at', endIso)
      .order('observed_at', { ascending: true })
      .range(1000, 1999);
    if (!p2.error && p2.data?.length) {
      rows.push(...(p2.data as Array<{ observed_at: string; temperature_c: number | null }>));
    }
  }

  let obsHiC = -Infinity;
  let obsLoC = Infinity;
  let validTempCount = 0;
  let firstMs = Infinity;
  let lastMs = -Infinity;

  for (const r of rows) {
    const ms = parseUtcMs(r.observed_at);
    if (ms !== null) {
      if (ms < firstMs) firstMs = ms;
      if (ms > lastMs) lastMs = ms;
    }
    if (typeof r.temperature_c === 'number' && Number.isFinite(r.temperature_c)) {
      validTempCount += 1;
      if (r.temperature_c > obsHiC) obsHiC = r.temperature_c;
      if (r.temperature_c < obsLoC) obsLoC = r.temperature_c;
    }
  }
  if (validTempCount === 0 || !Number.isFinite(firstMs) || !Number.isFinite(lastMs)) {
    return null;
  }

  const ok = isEcowittTempDayValid({
    sampleCount: rows.length,
    firstMinuteIct: (firstMs - dayStartMs) / 60_000,
    lastMinuteIct: (lastMs - dayStartMs) / 60_000,
  });
  return ok ? { obsHiC, obsLoC } : null;
}

async function loadTrailingBiases(
  todayIct: string,
  signal?: AbortSignal,
): Promise<V4TrailingBiases> {
  if (
    cachedBiases &&
    cachedBiases.dateIct === todayIct &&
    Date.now() < cachedBiases.expiresAt
  ) {
    return cachedBiases.biases;
  }

  const candidateDays: string[] = [];
  for (let d = -LOOKBACK_DAYS; d <= -1; d++) {
    candidateDays.push(addDaysYmd(todayIct, d));
  }

  const [ecowittPrev, spireHist] = await Promise.all([
    fetchEcmwfPrevDay1(signal),
    fetchSpireHistoricalDayAhead(candidateDays),
  ]);

  const pairedDays = candidateDays.filter(
    (d) => ecowittPrev.has(d) && spireHist.has(d),
  );

  const ecowittByDay = new Map<string, { obsHiC: number; obsLoC: number }>();
  for (let i = 0; i < pairedDays.length; i += 12) {
    const batch = pairedDays.slice(i, i + 12);
    const results = await Promise.all(batch.map((d) => fetchEcowittDayTempSummary(d)));
    batch.forEach((d, idx) => {
      const res = results[idx];
      if (res) ecowittByDay.set(d, res);
    });
  }

  const pairs: HistoricalTempPair[] = [];
  for (const d of pairedDays) {
    const obs = ecowittByDay.get(d);
    const sp = spireHist.get(d);
    const ec = ecowittPrev.get(d);
    if (!obs || !sp || !ec) continue;
    pairs.push({
      date: d,
      obsHiC: obs.obsHiC,
      obsLoC: obs.obsLoC,
      spireHiC: sp.hiC,
      spireLoC: sp.loC,
      ecmwfHiC: ec.hiC,
      ecmwfLoC: ec.loC,
    });
  }

  const biases = computeTrailingBiases(pairs, todayIct, V4_BIAS_WINDOW_DAYS);
  if (biases.samplesUsed > 0) {
    cachedBiases = {
      dateIct: todayIct,
      expiresAt: Date.now() + BIAS_CACHE_TTL_MS,
      biases,
    };
  }
  return biases;
}

async function fetchStoredTodaySpireHours(
  todayIct: string,
): Promise<Array<{ timeUtc: string; tempC: number }>> {
  const sb = getSupabaseAdmin();
  const range = ictDayUtcRange(todayIct);
  if (!sb || !range) return [];
  const startIso = range.startUtc.toISOString();
  const endIso = range.endUtc.toISOString();

  const [hist, curr] = await Promise.all([
    sb
      .from('weather_history')
      .select('valid_time_utc,issuance_time_utc,air_temperature_c')
      .eq('location_id', SPIRE_LOCATION_ID)
      .gte('valid_time_utc', startIso)
      .lt('valid_time_utc', endIso)
      .limit(100),
    sb
      .from('weather_forecast')
      .select('valid_time_utc,issuance_time_utc,air_temperature_c')
      .eq('location_id', SPIRE_LOCATION_ID)
      .gte('valid_time_utc', startIso)
      .lt('valid_time_utc', endIso)
      .limit(100),
  ]);

  const byHour = new Map<string, { issMs: number; tempC: number }>();
  for (const row of [...(hist.data ?? []), ...(curr.data ?? [])] as Array<{
    valid_time_utc: string;
    issuance_time_utc: string | null;
    air_temperature_c: number | null;
  }>) {
    if (typeof row.air_temperature_c !== 'number' || !Number.isFinite(row.air_temperature_c)) {
      continue;
    }
    const k = canonicalUtcHourIso(row.valid_time_utc);
    if (!k) continue;
    const issMs = row.issuance_time_utc ? (parseUtcMs(row.issuance_time_utc) ?? 0) : 0;
    const prev = byHour.get(k);
    if (!prev || issMs >= prev.issMs) {
      byHour.set(k, { issMs, tempC: row.air_temperature_c });
    }
  }

  return [...byHour.entries()].map(([timeUtc, v]) => ({ timeUtc, tempC: v.tempC }));
}

export async function enrichWeatherWithV4Blend(
  forecast: SamuiWeatherForecastRow[],
  parentSignal?: AbortSignal,
): Promise<{
  forecast: SamuiWeatherForecastRow[];
  temperatureBlend: V4TemperatureBlendSummary;
}> {
  const todayIct = ictYmd();
  const signal = combinedSignal(parentSignal, BLEND_TIMEOUT_MS);

  try {
    const [biases, ecmwfLive, todayStoredSpire] = await Promise.all([
      loadTrailingBiases(todayIct, signal),
      fetchEcmwfLive(signal),
      fetchStoredTodaySpireHours(todayIct),
    ]);

    const enrichedForecast = forecast.map((row) => {
      const utcKey = canonicalUtcHourIso(row.time);
      const ecmwfTemp = utcKey ? ecmwfLive.hoursByUtcIso.get(utcKey) : undefined;
      const ictHour = ictHourFromUtcIso(row.time);
      const { ecmwfTempRawC, tempBlendC } = computeHourlyBlendTemp({
        spireTempC: row.temp,
        ecmwfTempC: ecmwfTemp,
        ictHour,
        biases,
      });
      return {
        ...row,
        ecmwfTempRawC,
        tempBlendC,
      };
    });

    const spireByDay = new Map<string, Map<string, number>>();
    for (const h of todayStoredSpire) {
      const day = ictDateFromUtcIso(h.timeUtc);
      const key = canonicalUtcHourIso(h.timeUtc);
      if (!day || !key) continue;
      const m = spireByDay.get(day) ?? new Map<string, number>();
      m.set(key, h.tempC);
      spireByDay.set(day, m);
    }
    for (const row of forecast) {
      const day = ictDateFromUtcIso(row.time);
      const key = canonicalUtcHourIso(row.time);
      if (!day || !key || typeof row.temp !== 'number' || !Number.isFinite(row.temp)) continue;
      const m = spireByDay.get(day) ?? new Map<string, number>();
      m.set(key, row.temp);
      spireByDay.set(day, m);
    }

    const ecmwfByDay = new Map<string, Array<{ timeUtc: string; tempC: number }>>();
    for (const [timeUtc, tempC] of ecmwfLive.hoursByUtcIso.entries()) {
      const day = ictDateFromUtcIso(timeUtc);
      if (!day) continue;
      const list = ecmwfByDay.get(day) ?? [];
      list.push({ timeUtc, tempC });
      ecmwfByDay.set(day, list);
    }

    const days = [...spireByDay.keys()].sort();
    const daily: V4DailyTempForecast[] = days.map((date) => {
      const spMap = spireByDay.get(date) ?? new Map<string, number>();
      const spireHours = [...spMap.entries()].map(([timeUtc, tempC]) => ({ timeUtc, tempC }));
      const ecmwfHours = ecmwfByDay.get(date) ?? [];
      return computeBlendDailyEntry({
        date,
        spireHours,
        ecmwfHours,
        biases,
      });
    });

    return {
      forecast: enrichedForecast,
      temperatureBlend: {
        available:
          biases.samplesUsed > 0 &&
          daily.some((d) => d.blendHiC !== null || d.blendLoC !== null),
        model: V4_BLEND_MODEL_ID,
        timezone: 'Asia/Bangkok',
        ecmwfModel: 'ecmwf_ifs025',
        ecmwfGrid: {
          lat: SAMUI_CENTER.lat,
          lon: SAMUI_CENTER.lon,
          elevationM: ecmwfLive.elevationM,
        },
        biasesC: biases,
        daily,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'v4 temperature blend failed';
    console.error('[v4-temperature-blend]', message);
    return {
      forecast,
      temperatureBlend: {
        available: false,
        model: V4_BLEND_MODEL_ID,
        timezone: 'Asia/Bangkok',
        ecmwfModel: 'ecmwf_ifs025',
        ecmwfGrid: {
          lat: SAMUI_CENTER.lat,
          lon: SAMUI_CENTER.lon,
          elevationM: null,
        },
        biasesC: {
          windowDays: V4_BIAS_WINDOW_DAYS,
          samplesUsed: 0,
          windowFrom: null,
          windowTo: null,
          spireHiBiasC: null,
          spireLoBiasC: null,
          ecmwfHiBiasC: null,
          ecmwfLoBiasC: null,
        },
        daily: [],
        error: message,
      },
    };
  }
}
