/**
 * PostgREST / Supabase views: `sammi_forecast`, `sammi_daily_forecast` (see supabase/013_sammi_forecast_views.sql).
 */

import type { SamuiWeatherForecastRow } from './spire';

export type SammiReliability = 'high' | 'medium' | 'low';

/** CAPE+PWAT+CIN environment (single hour); `long_range` when reliability is low. */
export type SammiTropicalTier =
  | 'long_range'
  | 'exceptional'
  | 'storm_likely'
  | 'afternoon_showers'
  | 'stable'
  | 'capped_uncertain'
  | 'mixed';

/** DCAPE → gust risk (guide bands). */
export type SammiWindTier = 'calm' | 'light_gusts' | 'strong_gusts' | 'severe_gusts';

export interface SammiForecastViewRow {
  location_id: string;
  valid_time_utc: string;
  kans_regen_pct_sammi: number | null;
  kans_onweer_pct_sammi: number | null;
  kans_mist_pct_sammi: number | null;
  reliability: SammiReliability;
  resolution?: string | null;
  /** J/kg — matches `weather_forecast.cin` / Spire thunder bundle. */
  cin?: number | null;
  /** m AGL — lowest cloud base with >50% cover (beach visibility). */
  ceiling_m?: number | null;
  /** DB snake_case; PostgREST returns these on `sammi_forecast` */
  sammi_tropical_tier?: SammiTropicalTier | null;
  sammi_wind_tier?: SammiWindTier | null;
  sammi_convective_line?: string | null;
  /** Degrees meteorological (from); matches `weather_forecast.wind_direction_deg` / Spire ingest. */
  wind_direction_deg?: number | null;
}

export interface SammiDailyForecastViewRow {
  location_id: string;
  /** Bangkok calendar day */
  forecast_date: string;
  kans_regen_pct_sammi: number | null;
  kans_onweer_pct_sammi: number | null;
  kans_mist_pct_sammi: number | null;
  reliability: SammiReliability;
  sammi_advice: string;
  avg_temp_c?: number | null;
  max_temp_c?: number | null;
  min_temp_c?: number | null;
  /** 10:00–18:00 Bangkok window maxes */
  conv_cape_max?: number | null;
  conv_pwat_max?: number | null;
  conv_cin_max?: number | null;
  conv_dcape_max?: number | null;
  /** Min ceiling (m AGL) in 10–18 BKK window — surface visibility / “beach grey”. */
  conv_ceiling_min?: number | null;
  sammi_tropical_tier?: SammiTropicalTier | null;
  sammi_wind_tier?: SammiWindTier | null;
}

/**
 * Spire `row.time` and DB `valid_time_utc` are matched at whole-second resolution (UTC instants).
 */
export function mergeTimeKeyUtc(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  return String(Math.floor(t / 1000));
}

/**
 * Use Sammi rain % when present; otherwise same heuristic as the hourly strip (Spire pop).
 */
export function rainChancePercentForRow(row: SamuiWeatherForecastRow): number {
  const k = row.sammi?.kansRegenPctSammi;
  if (k != null && Number.isFinite(k)) return k;
  let pop = row.pop;
  if (!pop && row.precipRate > 0) {
    pop = Math.min(100, Math.round(row.precipRate * 20) + 20);
  }
  return pop;
}
