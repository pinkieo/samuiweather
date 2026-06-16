import type { CSSProperties } from 'react';
import type { SamuiWeatherForecastRow } from './spire';
import { hourBucketKeyBangkok, type HourBucketRadar } from './radar-hourly-buckets';
import { rainChancePercentForRow } from './sammi-views';

/** Nowcast step stats + raster drift — used by hybrid strip / map scrub routing */
export {
  calculateRainMovementVector,
  nowcastIndexForHourOffset,
  rasterDriftPxForHour,
} from './rainviewer-motion';

/** Dominant-cell lat/lon tracking between nowcast frames (largest echo blob centroid). */
export {
  bearingDeg,
  calculateRainCellMovement,
  centroidLatLonForFrame,
  cellMotionTrendVsPin,
  extrapolateRainCellLatLon,
  type RainCellCentroid,
  type RainCellMotion,
} from './rainviewer-cell-motion';

export type HybridLayer = 'radar' | 'blend' | 'forecast';

/** Hours before the current Bangkok clock hour (inclusive in the strip window). */
export const HYBRID_STRIP_PAST_COUNT = 2;
/**
 * Hours after the current Bangkok hour start; strip length =
 * `HYBRID_STRIP_PAST_COUNT + 1 + HYBRID_STRIP_FUTURE_COUNT` (= 18 with defaults).
 */
export const HYBRID_STRIP_FUTURE_COUNT = 15;

export type HybridRainLabel = 'Heavy' | 'Moderate' | 'Light' | 'Passing';

/**
 * One hour column on the hybrid strip.
 * `offset`: hours vs current Bangkok clock hour (0 = now, negative = past, positive = future).
 */
export type HybridHour = {
  hourStartUtc: number;
  key: string;
  offset: number;
  layer: HybridLayer;
  /** 0…1 for bar colour and trend math */
  intensity: number;
  /** How much to trust this column (higher for fresh radar) */
  reliabilityPct: number;
  /** Versus the next hour */
  trend: 'in' | 'out' | 'flat';
  radarLevel: 0 | 1 | null;
  modelRainPct: number;
  /** Compact rain descriptor for the hour */
  rainLabel: HybridRainLabel;
};

const TZ = 'Asia/Bangkok';

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function modelRainPctAndIntensity(row: SamuiWeatherForecastRow | null): { pct: number; base: number } {
  if (!row) return { pct: 0, base: 0.1 };
  const pct = rainChancePercentForRow(row);
  const p = clamp01(pct / 100);
  const pr = Math.min(1, (row.precipRate || 0) * 0.45);
  const base = clamp01(p * 0.8 + pr * 0.2);
  return { pct: Math.round(pct), base };
}

/**
 * Spire row closest to the middle of the Bangkok hour window.
 */
export function findForecastRowNearHour(
  rows: SamuiWeatherForecastRow[],
  hourStartUtc: number,
): SamuiWeatherForecastRow | null {
  if (rows.length === 0) return null;
  const tMid = (hourStartUtc + 1800) * 1000;
  let best: SamuiWeatherForecastRow | null = null;
  let bestD = Infinity;
  for (const r of rows) {
    const t = new Date(r.time).getTime();
    if (Number.isNaN(t)) continue;
    const d = Math.abs(t - tMid);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  if (!best || bestD > 2.5 * 3600 * 1000) return null;
  return best;
}

function layerForClockOffset(clockOffset: number): HybridLayer {
  if (clockOffset < 0) return 'radar';
  if (clockOffset < 3) return 'radar';
  if (clockOffset < 6) return 'blend';
  return 'forecast';
}

/**
 * 100% at hour 0 → 30% at the last step (18-hour strip). Later hours lean more on the model.
 */
export function hybridReliabilityPct(offset: number, total: number): number {
  if (total <= 1) return 100;
  return Math.round(100 - (offset * (70 / (total - 1))));
}

function sammiTierBoost(row: SamuiWeatherForecastRow | null): number {
  const t = row?.sammi?.tropicalTier;
  if (t === 'exceptional' || t === 'storm_likely') return 0.1;
  if (t === 'afternoon_showers' || t === 'mixed') return 0.05;
  if (t === 'capped_uncertain') return 0.02;
  return 0;
}

function hybridRainLabelFromIntensity(intensity: number): HybridRainLabel {
  const t = clamp01(intensity);
  if (t >= 0.62) return 'Heavy';
  if (t >= 0.4) return 'Moderate';
  if (t >= 0.22) return 'Light';
  return 'Passing';
}

const HYBRID_COLORS = {
  c1: '#4FC3F7',
  c2: '#1565C0',
  c3: '#7B1FA2',
  c4: '#B71C1C',
} as const;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function lerpByte(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function lerpHex(c1: string, c2: string, t: number): string {
  const A = hexToRgb(c1);
  const B = hexToRgb(c2);
  return `rgb(${lerpByte(A.r, B.r, t)}, ${lerpByte(A.g, B.g, t)}, ${lerpByte(A.b, B.b, t)})`;
}

/**
 * Build hybrid hour cells from radar hour buckets and merged forecast rows.
 */
export function buildHybridTimeline(
  hourStarts: number[],
  radarBuckets: HourBucketRadar[],
  forecastRows: SamuiWeatherForecastRow[],
  pastCount: number = 0,
): HybridHour[] {
  const byKey = new Map(radarBuckets.map((b) => [b.key, b]));
  const n = hourStarts.length;
  const raw: Array<{
    hourStartUtc: number;
    key: string;
    offset: number;
    layer: HybridLayer;
    intensity: number;
    reliabilityPct: number;
    radarLevel: 0 | 1 | null;
    modelRainPct: number;
  }> = [];

  for (let i = 0; i < n; i++) {
    const hourStartUtc = hourStarts[i]!;
    const key = hourBucketKeyBangkok(hourStartUtc);
    const b = byKey.get(key);
    const rlv = b?.level ?? null;
    const row = findForecastRowNearHour(forecastRows, hourStartUtc);
    const { pct, base: m } = modelRainPctAndIntensity(row);
    /** Hours relative to the current Bangkok clock hour (0 = now). */
    const clockOffset = i - pastCount;
    const layer = layerForClockOffset(clockOffset);

    let intensity: number;
    if (clockOffset < 0) {
      if (rlv === 1) intensity = clamp01(0.78 + 0.12 * m);
      else if (rlv === 0) intensity = clamp01(0.08 + 0.36 * m);
      else intensity = m;
    } else if (clockOffset < 3) {
      if (rlv === 1) intensity = clamp01(0.82 + 0.12 * m);
      else if (rlv === 0) intensity = clamp01(0.1 + 0.35 * m);
      else intensity = m;
    } else if (clockOffset < 6) {
      const rad =
        rlv === 1 ? 0.72 : rlv === 0 ? 0.12 : m;
      intensity = clamp01(0.42 * rad + 0.58 * m);
    } else {
      const tier = sammiTierBoost(row);
      const pr = Math.min(0.25, (row?.precipRate || 0) * 0.35);
      intensity = clamp01(m * 0.88 + pr + tier);
    }

    raw.push({
      hourStartUtc,
      key,
      offset: clockOffset,
      layer,
      intensity,
      reliabilityPct: hybridReliabilityPct(i, n),
      radarLevel: rlv,
      modelRainPct: pct,
    });
  }

  return raw.map((h, i, arr) => {
    const next = arr[i + 1];
    const delta = next ? next.intensity - h.intensity : 0;
    let trend: 'in' | 'out' | 'flat' = 'flat';
    if (next) {
      if (delta > 0.07) trend = 'in';
      else if (delta < -0.07) trend = 'out';
    }
    const rainLabel = hybridRainLabelFromIntensity(h.intensity);
    return { ...h, trend, rainLabel };
  });
}

/**
 * Bar fill: light blue → dark blue → purple → red with subtle depth (tropical rain ladder).
 */
export function hybridBarStyle(intensity: number): CSSProperties {
  const t = clamp01(intensity);
  const shadow =
    '0 3px 12px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.14)';
  if (t < 0.06) {
    return {
      background: 'linear-gradient(180deg, rgba(30,41,59,0.94) 0%, rgba(15,23,42,0.98) 100%)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
    };
  }
  const u = (t - 0.06) / 0.94;
  let top: string;
  let bot: string;
  if (u < 1 / 3) {
    const w = u * 3;
    top = lerpHex(HYBRID_COLORS.c1, HYBRID_COLORS.c2, w);
    bot = lerpHex(HYBRID_COLORS.c2, '#0D47A1', w);
  } else if (u < 2 / 3) {
    const w = (u - 1 / 3) * 3;
    top = lerpHex(HYBRID_COLORS.c2, HYBRID_COLORS.c3, w);
    bot = lerpHex('#0D47A1', '#4A148C', w);
  } else {
    const w = (u - 2 / 3) * 3;
    top = lerpHex(HYBRID_COLORS.c3, HYBRID_COLORS.c4, w);
    bot = lerpHex('#4A148C', '#7F0000', w);
  }
  return {
    background: `linear-gradient(180deg, ${top} 0%, ${bot} 100%)`,
    boxShadow: u > 0.55 ? `${shadow}, 0 0 14px rgba(183,28,28,0.28)` : shadow,
  };
}

/**
 * One short tourist-friendly line (English) — no model jargon.
 * Optional `forecastRows`: uses `sammi_convective_line` (merged on row) for 6+ h if present.
 */
export function pickHybridHeadline(
  hours: HybridHour[],
  forecastRows?: SamuiWeatherForecastRow[],
): string {
  if (hours.length === 0) return 'Rain outlook will show once data is ready.';

  const nowI = Math.max(0, hours.findIndex((h) => h.offset === 0));
  const h0 = hours[nowI]!;
  const h1 = hours[nowI + 1];
  const h2 = hours[nowI + 2];

  const endNear = Math.min(nowI + 3, hours.length - 1);
  for (let i = nowI; i < endNear; i++) {
    const a = hours[i]!;
    const b = hours[i + 1]!;
    if (a.intensity < 0.22 && b.intensity > 0.55) {
      return 'Heavier rain is building — the next hour or so, keep shelter in mind.';
    }
  }

  if (h0.intensity > 0.5 && h1 && h1.intensity < h0.intensity * 0.55) {
    return 'That shower is easing off — it should get lighter soon.';
  }

  if (h0.intensity > 0.4 && h2 && h0.intensity > 0.45 && h1 && h1.intensity > 0.45) {
    return 'Steady rain for a while — expect sustained heavy rain for the next few hours.';
  }

  const afternoon = hours.filter((h) => h.offset >= 4 && h.offset <= 14);
  if (afternoon.length > 0) {
    const maxI = Math.max(...afternoon.map((h) => h.intensity));
    const maxP = Math.max(...afternoon.map((h) => h.modelRainPct), 0);
    if (maxI > 0.52 && maxP >= 40) {
      return `Chance of rain later today — about ${maxP}% at the peak.`;
    }
  }

  if (forecastRows && forecastRows.length > 0) {
    for (const hb of hours) {
      if (hb.offset < 6 || hb.intensity < 0.28) continue;
      const row = findForecastRowNearHour(forecastRows, hb.hourStartUtc);
      const c = row?.sammi?.convectiveLine?.trim();
      if (c) {
        return c.length > 128 ? `${c.slice(0, 125)}…` : c;
      }
    }
  }

  if (h0.intensity < 0.18) {
    const nearNow = hours.filter((h) => h.offset >= 0 && h.offset < 6);
    const maxNext =
      nearNow.length > 0 ? Math.max(...nearNow.map((h) => h.intensity)) : 0;
    if (maxNext < 0.3) {
      return 'The next few hours look mostly dry — a good window to be outside.';
    }
  }

  if (h0.modelRainPct >= 15 && h0.modelRainPct < 45) {
    return 'A few sprinkles are possible on and off — a light cover helps.';
  }

  return 'Darker or warmer colors mean a wetter hour; the number is how sure we are.';
}

export function formatHourLabelBangkok(utcSec: number, isNow: boolean): string {
  if (isNow) return 'Now';
  const h = new Date(utcSec * 1000).toLocaleString('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    hour12: false,
  });
  return `${h}h`;
}
