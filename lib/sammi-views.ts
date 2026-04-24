/**
 * PostgREST / Supabase views: `sammi_forecast`, `sammi_daily_forecast` (see supabase/013_sammi_forecast_views.sql).
 */

import type { SamuiWeatherForecastRow } from './spire';

export type SammiReliability = 'high' | 'medium' | 'low';

export interface SammiForecastViewRow {
  location_id: string;
  valid_time_utc: string;
  kans_regen_pct_sammi: number | null;
  kans_onweer_pct_sammi: number | null;
  kans_mist_pct_sammi: number | null;
  reliability: SammiReliability;
  resolution?: string | null;
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
