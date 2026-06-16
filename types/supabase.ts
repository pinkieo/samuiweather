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

/**
 * One raw Ecowitt station upload normalized for metric dashboards and ML labels.
 * Source: Baan Ton Kluay weather station custom upload.
 */
export interface EcowittObservation {
  id?: string;
  observedAt: string;
  locationId: string;
  stationType: string | null;
  stationId: string | null;
  temperatureC: number | null;
  humidityPct: number | null;
  indoorTemperatureC: number | null;
  indoorHumidityPct: number | null;
  relativePressureHpa: number | null;
  absolutePressureHpa: number | null;
  windSpeedMs: number | null;
  windGustMs: number | null;
  windDirectionDeg: number | null;
  rainRateMmh: number | null;
  rainHourMm: number | null;
  rainDayMm: number | null;
  rainWeekMm: number | null;
  rainMonthMm: number | null;
  rainYearMm: number | null;
  rainEventMm: number | null;
  solarWm2: number | null;
  uvIndex: number | null;
  lightningDistanceKm: number | null;
  lightningCount: number | null;
  batteryStatus: Record<string, string> | null;
  rawJson: Record<string, string>;
  createdAt?: string;
}
