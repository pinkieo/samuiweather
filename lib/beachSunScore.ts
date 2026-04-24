import type { SamuiWeatherForecastRow } from './spire';

export type BeachSunColor = 'emerald' | 'lime' | 'amber' | 'orange' | 'red';

/** Full Tailwind classes — do not build from dynamic strings (JIT safelist). */
export const beachScoreVerdictClasses: Record<
  BeachSunColor,
  { bg: string; border: string; text: string; dot: string }
> = {
  emerald: {
    bg: 'bg-emerald-950/60',
    border: 'border-emerald-500/40',
    text: 'text-emerald-200',
    dot: 'bg-emerald-400',
  },
  lime: {
    bg: 'bg-lime-950/60',
    border: 'border-lime-500/40',
    text: 'text-lime-200',
    dot: 'bg-lime-400',
  },
  amber: {
    bg: 'bg-amber-950/60',
    border: 'border-amber-500/40',
    text: 'text-amber-200',
    dot: 'bg-amber-400',
  },
  orange: {
    bg: 'bg-orange-950/60',
    border: 'border-orange-500/40',
    text: 'text-orange-200',
    dot: 'bg-orange-400',
  },
  red: {
    bg: 'bg-red-950/60',
    border: 'border-red-500/40',
    text: 'text-red-200',
    dot: 'bg-red-400',
  },
};

export type BeachSunScoreResult = {
  score: number;
  label: string;
  color: BeachSunColor;
  advice: string;
  lowCloud: number;
  ceiling: number;
};

export function calculateBeachSunScore(row: SamuiWeatherForecastRow): BeachSunScoreResult {
  const low = row.spireCloudLow ?? 0;
  const mid = row.spireCloudMid ?? 0;
  const high = row.spireCloudHigh ?? 0;
  const total = row.cloudCover ?? 0;
  const ceiling = row.cloudCeiling ?? row.sammi?.ceilingM ?? 99999;
  const cape = row.cape ?? 0;
  const pwat = row.pwat ?? 0;
  const dcape = row.dcape ?? 0;
  const precipRate = row.precipRate ?? 0;
  /** Spire first; else Sammi same-hour (view) when thunder bundle missing on the client row. */
  const cinRaw = pickCinJkg(row);

  let score = 100;

  score -= low * 0.72;
  score -= mid * 0.28;
  score -= high * 0.09;
  score -= Math.max(0, total - low - mid) * 0.12;

  if (ceiling < 1200) score -= 32;
  if (ceiling < 600) score -= 25;

  /* Samui tropical guide: CAPE>2000 + PWAT>55 = strongly unstable; DCAPE>800 = strong gusts */
  if (cape > 2000 && pwat > 55) score -= 45;
  if (dcape > 800) score -= 28;
  if (precipRate > 0.4) score -= 35;

  /**
   * CIN (J/kg) is typically <= 0 in model output: closer to 0 = weaker “lid” (less inhibition),
   * more negative = stronger cap. Product rule from concierge tuning:
   * - Strong cap (e.g. < −50 J/kg): slightly worse score (gloomier or storm-on-break risk).
   * - Weaker cap / near-neutral (−50 … 0): small bonus — “quieter” feel for a beach day.
   */
  if (cinRaw != null && Number.isFinite(cinRaw)) {
    if (cinRaw < -50) score -= 8;
    else if (cinRaw <= 0) score += 3;
  }

  score = Math.max(5, Math.min(100, Math.round(score)));

  let label = '🏖️ Perfect Beach Day';
  let color: BeachSunColor = 'emerald';
  let advice = 'Full beach weather — great time to go.';

  if (score >= 85) {
    // perfect
  } else if (score >= 70) {
    label = '🏝️ Good Beach Day';
    advice = 'Good beach conditions — watch for afternoon showers in the hourly strip.';
    color = 'lime';
  } else if (score >= 50) {
    label = '⛅ Mixed Conditions';
    advice = 'Morning often better than afternoon — check the hourly forecast.';
    color = 'amber';
  } else if (score >= 30) {
    label = '🌧️ Marginal';
    advice = 'Bring a brolly and keep an indoor plan B.';
    color = 'orange';
  } else {
    label = '⛈️ Bad Beach Day';
    advice = 'Better to stay indoors or pick covered activities.';
    color = 'red';
  }

  return { score, label, color, advice, lowCloud: low, ceiling };
}

function pickCinJkg(row: SamuiWeatherForecastRow): number | null {
  if (row.cin != null && Number.isFinite(row.cin)) return row.cin;
  const s = row.sammi?.cinJkg;
  if (s != null && Number.isFinite(s)) return s;
  return null;
}
