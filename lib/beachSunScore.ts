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
  const ceiling = row.cloudCeiling ?? 99999;
  const cape = row.cape ?? 0;
  const pwat = row.pwat ?? 0;
  const dcape = row.dcape ?? 0;
  const precipRate = row.precipRate ?? 0;

  let score = 100;

  score -= low * 0.72;
  score -= mid * 0.28;
  score -= high * 0.09;
  score -= Math.max(0, total - low - mid) * 0.12;

  if (ceiling < 1200) score -= 32;
  if (ceiling < 600) score -= 25;

  if (cape > 2200 && pwat > 55) score -= 45;
  if (dcape > 850) score -= 28;
  if (precipRate > 0.4) score -= 35;

  score = Math.max(5, Math.min(100, Math.round(score)));

  let label = '🏖️ Perfect Beach Day';
  let color: BeachSunColor = 'emerald';
  let advice = 'Volledig strandweer – ga nu!';

  if (score >= 85) {
    // perfect
  } else if (score >= 70) {
    label = '🏝️ Good Beach Day';
    advice = 'Goed strandweer, maar let op de namiddagbui.';
    color = 'lime';
  } else if (score >= 50) {
    label = '⛅ Mixed Conditions';
    advice = 'Ochtend vaak beter dan middag – check hourly.';
    color = 'amber';
  } else if (score >= 30) {
    label = '🌧️ Marginal';
    advice = 'Paraplu mee en indoor alternatief klaar.';
    color = 'orange';
  } else {
    label = '⛈️ Bad Beach Day';
    advice = 'Beter indoor of overdekte activiteit.';
    color = 'red';
  }

  return { score, label, color, advice, lowCloud: low, ceiling };
}
