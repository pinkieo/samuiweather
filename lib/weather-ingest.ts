/**
 * 4× daily Spire ingest into weather_forecast + weather_forecast_snapshot.
 * Same contract merge as lib/spire.ts; flatten matches weather_engine_hourly.py.
 */

import { createHash } from 'node:crypto';
import {
  fetchLatestRainViewerFramePath,
  sampleRainViewerTileAtLocation,
} from '@/lib/rainviewer-server-sample';
import {
  SAMUI_CENTER,
  computeSpirePointDataStats,
  fetchSpireMergedRawAt,
} from '@/lib/spire';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const DEFAULT_WEATHER_LOCATION_ID = 'samui_opf_hybrid';
/** Skip a second Spire pull inside the same 6-hour slot. */
export const DEFAULT_SKIP_IF_FRESH_MINUTES = 180;

type RadarStatus = 'clear' | 'rain' | 'unknown';

export type WeatherIngestSummary = {
  skipped: boolean;
  reason?: string;
  location_id: string;
  lat: number;
  lon: number;
  row_count?: number;
  first_valid_time?: string | null;
  last_valid_time?: string | null;
  updated_at?: string;
  radar_status?: RadarStatus;
  age_minutes?: number;
  skip_if_fresh_minutes?: number;
};

function pickNum(v: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const x = v[k];
    if (typeof x === 'number' && Number.isFinite(x)) return x;
  }
  return null;
}

function kToC(k: number | null): number | null {
  if (k == null) return null;
  return Math.round((k - 273.15) * 1000) / 1000;
}

function normalizeProbPercent(x: number): number {
  if (x >= 0 && x <= 1) return Math.round(x * 10000) / 100;
  return Math.min(100, Math.max(0, Math.round(x * 100) / 100));
}

function pickProbPct(v: Record<string, unknown>, keys: string[]): number | null {
  const x = pickNum(v, keys);
  if (x == null) return null;
  return normalizeProbPercent(x);
}

function pctCloud(v: Record<string, unknown>, keys: string[]): number {
  const x = pickNum(v, keys);
  if (x == null) return 0;
  if (x >= 0 && x <= 1) return x * 100;
  return Math.max(0, Math.min(100, x));
}

function toIctLabel(isoUtc: string): string {
  try {
    return (
      new Date(isoUtc).toLocaleString('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).replace(',', '') + ' ICT'
    );
  } catch {
    return isoUtc;
  }
}

function beachScore(values: Record<string, unknown>, airC: number | null, radarRain: boolean): number {
  let s = 10;
  const low = pctCloud(values, ['low_cloud_cover', 'cloud_cover_low', 'low_level_cloud_cover']);
  s -= (low / 100) * 2.5;
  const thunder = pickProbPct(values, ['probability_of_thunderstorm']);
  if (thunder != null && thunder > 20) s -= 1.75;
  const ceiling = pickNum(values, [
    'ceiling',
    'cloud_ceiling',
    'height_of_cloud_base_above_ground_level',
  ]);
  if (ceiling != null && ceiling < 1000) s -= 1.5;
  if (airC != null && airC >= 28 && airC <= 32) s += 0.5;
  if (radarRain) s -= 3;
  return Math.max(0, Math.min(10, Math.round(s * 100) / 100));
}

function isoUtc(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString();
}

function forecastLeadHours(validTime: string, issuanceTime: string): number {
  const valid = Date.parse(validTime);
  const issued = Date.parse(issuanceTime);
  if (!Number.isFinite(valid) || !Number.isFinite(issued)) return 0;
  return Math.round(((valid - issued) / 3600000) * 1e6) / 1e6;
}

function coerceWholeFloats(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [key, v] of Object.entries(out)) {
    if (key === 'values_json') continue;
    if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) out[key] = v;
    else if (typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v) out[key] = Math.trunc(v);
  }
  return out;
}

function skipIfFreshMinutes(): number | null {
  if (['1', 'true', 'yes'].includes((process.env.FORCE_INGEST || '').toLowerCase())) return null;
  const raw = (process.env.SKIP_IF_FRESH_MINUTES || '').trim();
  if (!raw) return DEFAULT_SKIP_IF_FRESH_MINUTES;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_SKIP_IF_FRESH_MINUTES;
  return n > 0 ? n : null;
}

function spireBundleChain(): string[] {
  const envB = process.env.SPIRE_FORECAST_BUNDLES?.trim();
  return [...new Set([envB, 'basic,maritime-atmos,clouds,thunderstorm', 'basic,maritime-atmos', 'basic'].filter(Boolean))] as string[];
}

export function flattenForDb(
  locationId: string,
  entry: unknown,
  radarStatus: RadarStatus,
  radarRain: boolean,
): Record<string, unknown> | null {
  const row = entry as {
    times?: { valid_time?: string; issuance_time?: string };
    values?: Record<string, unknown>;
  };
  const vt = row.times?.valid_time;
  if (!vt) return null;
  const v = row.values && typeof row.values === 'object' ? row.values : {};
  const airC = kToC(pickNum(v, ['air_temperature']));
  const issuance = row.times?.issuance_time ? isoUtc(row.times.issuance_time) : null;
  return {
    location_id: locationId,
    valid_time_utc: isoUtc(vt),
    valid_time_ict: toIctLabel(vt),
    issuance_time_utc: issuance,
    air_temperature_c: airC,
    wind_speed_ms: pickNum(v, ['wind_speed']),
    wind_direction_deg: pickNum(v, ['wind_direction']),
    wind_gust_ms: pickNum(v, ['wind_gust']),
    total_cloud_cover: pickNum(v, ['total_cloud_cover', 'cloud_cover']),
    low_cloud_cover: pickNum(v, ['low_cloud_cover', 'cloud_cover_low', 'low_level_cloud_cover']),
    mid_cloud_cover: pickNum(v, [
      'medium_cloud_cover',
      'mid_cloud_cover',
      'cloud_cover_mid',
      'mid_level_cloud_cover',
    ]),
    high_cloud_cover: pickNum(v, ['high_cloud_cover', 'cloud_cover_high', 'high_level_cloud_cover']),
    ceiling_m: pickNum(v, ['ceiling', 'cloud_ceiling', 'height_of_cloud_base_above_ground_level']),
    cape: pickNum(v, ['cape', 'CAPE', 'convective_available_potential_energy']),
    lifted_index: pickNum(v, ['lifted_index', 'lifted_index_500']),
    pwat: pickNum(v, [
      'precipitable_water',
      'precipitable_water_entire_atmosphere',
      'total_column_integrated_water_vapour',
      'tcw',
    ]),
    dcape: pickNum(v, ['downdraft_cape', 'downdraft_CAPE', 'dcape']),
    cin: pickNum(v, ['convective_inhibition', 'cin', 'CIN']),
    probability_of_precipitation_1hr: pickProbPct(v, [
      'probability_of_precipitation_1hr',
      'probability_of_precipitation',
      'pop',
    ]),
    probability_of_precipitation_24hr: pickProbPct(v, ['probability_of_precipitation_24hr']),
    probability_of_thunderstorm: pickProbPct(v, ['probability_of_thunderstorm']),
    probability_of_fog: pickProbPct(v, ['probability_of_fog', 'fog_probability']),
    precipitation_rate: pickNum(v, ['precipitation_rate']),
    relative_humidity: pickNum(v, ['relative_humidity']),
    values_json: v,
    beach_score: beachScore(v, airC, radarRain),
    radar_status: radarStatus,
  };
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = sortValue(o[k]);
    return out;
  }
  return v;
}

function snapshotHash(content: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortValue(content))).digest('hex');
}

function buildSnapshotRow(
  locationId: string,
  lat: number,
  lon: number,
  entry: unknown,
  flat: Record<string, unknown>,
  retrievedAt: string,
  opfApplied: boolean,
): Record<string, unknown> {
  const row = entry as { times?: { valid_time?: string; issuance_time?: string } };
  const validTime = String(row.times?.valid_time ?? flat.valid_time_utc);
  const spireIssuance = row.times?.issuance_time ? String(row.times.issuance_time) : null;
  const issuanceTime = spireIssuance ? isoUtc(spireIssuance) : retrievedAt;
  const normalizedKeys = [
    'air_temperature_c',
    'wind_speed_ms',
    'wind_direction_deg',
    'wind_gust_ms',
    'total_cloud_cover',
    'low_cloud_cover',
    'mid_cloud_cover',
    'high_cloud_cover',
    'ceiling_m',
    'cape',
    'lifted_index',
    'pwat',
    'dcape',
    'cin',
    'probability_of_precipitation_1hr',
    'probability_of_precipitation_24hr',
    'probability_of_thunderstorm',
    'probability_of_fog',
    'precipitation_rate',
    'relative_humidity',
  ] as const;
  const normalized: Record<string, unknown> = {};
  for (const key of normalizedKeys) normalized[key] = flat[key] ?? null;
  const contentForHash = {
    location_id: locationId,
    valid_time_utc: validTime,
    issuance_time_utc: issuanceTime,
    values_json: flat.values_json,
    normalized,
  };
  let opfHours = 72;
  const fhRaw = process.env.SPIRE_OPF_FORECAST_HOURS?.trim();
  if (fhRaw) {
    const n = parseInt(fhRaw, 10);
    if (Number.isFinite(n)) opfHours = Math.min(120, Math.max(24, n));
  }
  return {
    source_provider: 'spire',
    source_product: 'standard_point_plus_optimized_point_probability_overlay',
    source_composition: {
      standard_point: {
        endpoint: '/forecast/point',
        bundles_requested: spireBundleChain(),
        time_bundle: 'hourly,3_hourly,6_hourly_15day',
        forecast_hours: 360,
        product: process.env.SPIRE_FORECAST_PRODUCT?.trim() || null,
        unit_system: process.env.SPIRE_FORECAST_UNIT_SYSTEM?.trim() || null,
      },
      optimized_point_probability_overlay: {
        endpoint: '/forecast/point/optimized',
        location: process.env.SPIRE_OPF_LOCATION?.trim() || 'custom:PR_W1XNKK0',
        bundles_requested: [
          process.env.SPIRE_OPF_BUNDLES?.trim(),
          'basic,thunderstorm',
          'basic',
        ].filter(Boolean),
        time_bundle: 'hourly',
        forecast_hours: opfHours,
        product: process.env.SPIRE_FORECAST_PRODUCT?.trim() || null,
        unit_system: process.env.SPIRE_FORECAST_UNIT_SYSTEM?.trim() || null,
        applied_to_this_row: opfApplied,
      },
    },
    source_version: 'weather_ingest_http_v1',
    location_id: locationId,
    request_latitude: lat,
    request_longitude: lon,
    retrieved_at_utc: retrievedAt,
    issuance_time_utc: issuanceTime,
    issuance_time_source: spireIssuance ? 'spire' : 'retrieval_fallback',
    valid_time_utc: flat.valid_time_utc,
    forecast_lead_hours: forecastLeadHours(String(flat.valid_time_utc), issuanceTime),
    ...normalized,
    values_json: flat.values_json,
    opf_overlay_applied: opfApplied,
    snapshot_hash: snapshotHash(contentForHash),
  };
}

async function sampleRadar(lat: number, lon: number): Promise<{ status: RadarStatus; rain: boolean }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 4000);
  try {
    const path = await fetchLatestRainViewerFramePath(ac.signal);
    if (!path) return { status: 'unknown', rain: false };
    const sample = await sampleRainViewerTileAtLocation(lat, lon, path, ac.signal);
    if (sample === 'precip') return { status: 'rain', rain: true };
    if (sample === 'none') return { status: 'clear', rain: false };
    return { status: 'unknown', rain: false };
  } catch {
    return { status: 'unknown', rain: false };
  } finally {
    clearTimeout(t);
  }
}

export async function runWeatherIngest(opts?: {
  force?: boolean;
  signal?: AbortSignal;
}): Promise<{ ok: true; summary: WeatherIngestSummary } | { ok: false; error: string }> {
  const locationId = process.env.WEATHER_LOCATION_ID?.trim() || DEFAULT_WEATHER_LOCATION_ID;
  const lat = Number(process.env.SAMUI_LAT || SAMUI_CENTER.lat) || SAMUI_CENTER.lat;
  const lon = Number(process.env.SAMUI_LON || SAMUI_CENTER.lon) || SAMUI_CENTER.lon;
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, error: 'Supabase not configured' };

  if (opts?.force) process.env.FORCE_INGEST = '1';
  const skipMin = skipIfFreshMinutes();
  if (skipMin != null) {
    const { data } = await sb
      .from('weather_forecast')
      .select('updated_at')
      .eq('location_id', locationId)
      .order('updated_at', { ascending: false })
      .limit(1);
    const lastRaw = data?.[0]?.updated_at ? String(data[0].updated_at) : null;
    if (lastRaw) {
      const ageM = (Date.now() - Date.parse(lastRaw)) / 60000;
      if (Number.isFinite(ageM) && ageM < skipMin) {
        return {
          ok: true,
          summary: {
            skipped: true,
            reason: 'fresh',
            location_id: locationId,
            lat,
            lon,
            updated_at: lastRaw,
            age_minutes: Math.round(ageM * 10) / 10,
            skip_if_fresh_minutes: skipMin,
          },
        };
      }
    }
  }

  try {
    await sb.rpc('archive_expired_forecasts', { p_location_id: locationId });
  } catch (e) {
    console.warn('[weather-ingest] archive_expired_forecasts', e);
  }

  const radar = await sampleRadar(lat, lon);
  let merged: unknown[];
  try {
    merged = await fetchSpireMergedRawAt(lat, lon, opts?.signal);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!merged.length) return { ok: false, error: 'Spire contract merge returned no rows' };

  const stats = computeSpirePointDataStats(merged);
  const retrievedAt = new Date().toISOString();
  const nowIso = retrievedAt;
  const payload: Record<string, unknown>[] = [];
  const snapshots: Record<string, unknown>[] = [];
  for (const entry of merged) {
    const flat = flattenForDb(locationId, entry, radar.status, radar.rain);
    if (!flat) continue;
    const row = coerceWholeFloats({ ...flat, updated_at: nowIso });
    payload.push(row);
    const pop = (flat.values_json as Record<string, unknown> | undefined)?.probability_of_precipitation_1hr;
    const thunder = (flat.values_json as Record<string, unknown> | undefined)?.probability_of_thunderstorm;
    const fog = (flat.values_json as Record<string, unknown> | undefined)?.probability_of_fog;
    const opfApplied = pop != null || thunder != null || fog != null;
    snapshots.push(buildSnapshotRow(locationId, lat, lon, entry, flat, retrievedAt, opfApplied));
  }

  const { error: snapErr } = await sb.from('weather_forecast_snapshot').upsert(snapshots, {
    onConflict: 'location_id,valid_time_utc,issuance_time_utc',
  });
  if (snapErr) return { ok: false, error: `snapshot upsert: ${snapErr.message}` };

  const { error: upErr } = await sb.from('weather_forecast').upsert(payload, {
    onConflict: 'location_id,valid_time_utc',
  });
  if (upErr) return { ok: false, error: `forecast upsert: ${upErr.message}` };

  const summary: WeatherIngestSummary = {
    skipped: false,
    location_id: locationId,
    lat,
    lon,
    row_count: payload.length,
    first_valid_time: stats.firstValidTime,
    last_valid_time: stats.lastValidTime,
    updated_at: nowIso,
    radar_status: radar.status,
  };
  return { ok: true, summary };
}
