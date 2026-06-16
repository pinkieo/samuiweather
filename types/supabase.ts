/**
 * Supabase-aligned domain types (narrow tables only — not full generated DB types).
 */

/**
 * One row in `public.rain_observations` — features from RainViewer timeline + Spire
 * thunder/basic bundles; labels reserved for future supervised targets.
 */
export interface RainObservation {
  id?: string;
  observedAt: string;
  location: string;
  rainviewerTimestamp: string | null;
  rainRateMmh: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  spireCape: number | null;
  spirePwat: number | null;
  spireCin: number | null;
  /** Spire DCAPE (J/kg). */
  spireDcape: number | null;
  /** Model / derived probability (0–100 or 0–1 — document convention at ingest). */
  spireThunderstormProb: number | null;
  labelRainIn30Min: boolean | null;
  labelRainIn60Min: boolean | null;
  labelRainIn90Min: boolean | null;
  labelHeavyRain: boolean | null;
  labelStormHitsCoast: boolean | null;
  createdAt?: string;
}
