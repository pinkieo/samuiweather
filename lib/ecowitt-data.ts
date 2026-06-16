import { createClient } from '@supabase/supabase-js';
import type { EcowittObservation } from '@/types/supabase';

const DEFAULT_LOCATION_ID = 'baan_ton_kluay';

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
