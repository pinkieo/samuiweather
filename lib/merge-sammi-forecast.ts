import type { SamuiWeatherForecastRow } from './spire';
import type { SammiForecastViewRow } from './sammi-views';
import { mergeTimeKeyUtc } from './sammi-views';

/**
 * Merges hourly Sammi view rows into Spire client rows (same `time` ↔ `valid_time_utc`).
 */
export function mergeSamuiHourlyIntoRows(
  rows: SamuiWeatherForecastRow[],
  sammi: SammiForecastViewRow[],
): SamuiWeatherForecastRow[] {
  if (rows.length === 0 || sammi.length === 0) return rows;

  const bySec = new Map<string, SammiForecastViewRow>();
  for (const s of sammi) {
    if (s?.valid_time_utc) {
      bySec.set(mergeTimeKeyUtc(s.valid_time_utc), s);
    }
  }
  if (bySec.size === 0) return rows;

  return rows.map((row) => {
    const hit = bySec.get(mergeTimeKeyUtc(row.time));
    if (!hit) return row;

    const r = hit.reliability;
    if (r !== 'high' && r !== 'medium' && r !== 'low') return row;

    return {
      ...row,
      sammi: {
        kansRegenPctSammi:
          hit.kans_regen_pct_sammi != null
            ? Number(hit.kans_regen_pct_sammi)
            : null,
        kansOnweerPctSammi:
          hit.kans_onweer_pct_sammi != null
            ? Number(hit.kans_onweer_pct_sammi)
            : null,
        kansMistPctSammi:
          hit.kans_mist_pct_sammi != null
            ? Number(hit.kans_mist_pct_sammi)
            : null,
        reliability: r,
        tropicalTier: hit.sammi_tropical_tier ?? null,
        windTier: hit.sammi_wind_tier ?? null,
        convectiveLine: hit.sammi_convective_line ?? null,
        cinJkg: hit.cin != null && Number.isFinite(Number(hit.cin)) ? Number(hit.cin) : null,
        ceilingM:
          hit.ceiling_m != null && Number.isFinite(Number(hit.ceiling_m))
            ? Number(hit.ceiling_m)
            : null,
      },
    };
  });
}
