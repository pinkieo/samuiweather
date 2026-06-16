import type { SamuiWeatherForecastRow } from './spire';
import {
  airQualityBeachAdviceFragment,
  airQualityBeachPenalty,
  airQualitySeverity,
} from './air-quality-snapshot';
import { getFeelsLikeDeltaC } from './feels-like-heat-index';
import { rainChancePercentForRow } from './sammi-views';

const TZ_ICT = 'Asia/Bangkok';

export type BeachSunScoreContext = {
  /** Hourly (or sub-daily) rows — used to spot rain in the next few hours */
  hourlyRows: SamuiWeatherForecastRow[];
  /** ISO time of the row being scored — drives “evening / night” copy */
  anchorIso: string;
};

function bangkokHourFromIso(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 12;
  const hourStr = d.toLocaleTimeString('en-US', {
    timeZone: TZ_ICT,
    hour: '2-digit',
    hour12: false,
  });
  return parseInt(hourStr, 10) % 24;
}

function formatIctClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      timeZone: TZ_ICT,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

/** First wet hour in (anchor+startH, anchor+endH], ICT-agnostic wall-clock ordering */
function nextRainInWindow(
  rows: SamuiWeatherForecastRow[],
  anchorIso: string,
  startH: number,
  endH: number,
): SamuiWeatherForecastRow | null {
  const t0 = new Date(anchorIso).getTime();
  if (!Number.isFinite(t0)) return null;
  const msStart = t0 + startH * 3600 * 1000;
  const msEnd = t0 + endH * 3600 * 1000;
  let best: SamuiWeatherForecastRow | null = null;
  let bestT = Infinity;
  for (const r of rows) {
    const t = new Date(r.time).getTime();
    if (!Number.isFinite(t) || t <= msStart || t > msEnd) continue;
    const wet =
      (r.precipRate ?? 0) >= 0.08 ||
      (r.pop ?? 0) >= 35 ||
      rainChancePercentForRow(r) >= 42;
    if (wet && t < bestT) {
      bestT = t;
      best = r;
    }
  }
  return best;
}

function skyClearEnoughForStars(row: SamuiWeatherForecastRow): boolean {
  return (row.cloudCover ?? 0) < 62 && (row.precipRate ?? 0) < 0.06;
}

/**
 * Sammi-flavoured, time- and rain-aware line. Score band sets the baseline;
 * local hour and next showers override generic “full beach” copy.
 */
function feelsLikeBeachPenalty(deltaC: number): number {
  if (deltaC < 4) return 0;
  if (deltaC < 6) return 10;
  if (deltaC < 8) return 15;
  return 20;
}

function buildContextualBeachAdvice(
  row: SamuiWeatherForecastRow,
  hourlyRows: SamuiWeatherForecastRow[],
  anchorIso: string,
  score: number,
  uvWarning: boolean,
  uvWarningLine: string,
  feelsDelta: number,
): string {
  const h = bangkokHourFromIso(anchorIso);
  const rainRow =
    hourlyRows.length > 0 ? nextRainInWindow(hourlyRows, anchorIso, 1, 6) : null;
  const nowRaining = (row.precipRate ?? 0) > 0.18;

  let line: string;

  if (rainRow && !nowRaining) {
    const clock = formatIctClock(rainRow.time);
    if (h >= 6 && h < 18) {
      line = `Good now — rain expected by ${clock} ICT; enjoy while it's dry.`;
    } else if (h >= 18 && h < 22) {
      line = `Lovely this evening, but rain may arrive toward ${clock} ICT — a shorter stroll might be wise.`;
    } else {
      line = `Step out before ${clock} ICT if you want dry air — showers trend in after that.`;
    }
  } else if (h >= 22 || h < 5) {
    line = skyClearEnoughForStars(row)
      ? 'Quiet night — perfect for stargazing if the sky stays clear.'
      : 'Quiet night on the coast — sip something cool and enjoy the breeze.';
  } else if (h >= 18 && h < 22) {
    line = 'Great evening for a beach walk if it stays dry.';
  } else if (score >= 90) {
    line = 'Full beach weather — great time to go.';
  } else if (score >= 70) {
    line = 'Solid beach window — still peek at the hourly strip for showers.';
  } else if (score >= 60) {
    line = 'Mixed skies — mornings often kinder than afternoons.';
  } else if (score >= 35) {
    line = 'Bring a brolly and keep an indoor plan B.';
  } else {
    line = 'Better indoors or under cover today, darling.';
  }

  if (uvWarning) {
    line = `${uvWarningLine} ${line}`;
  }

  const extras: string[] = [];
  if (feelsDelta >= 4) {
    extras.push('Sticky heat index — hydrate and chase shade');
  }
  const aqFrag = airQualityBeachAdviceFragment(row);
  if (aqFrag) extras.push(`${aqFrag}.`);

  if (extras.length) {
    line = `${line} · ${extras.join(' · ')}`;
  }
  return line;
}

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
  /** Set when UV index ≥ 11 — stress shade / midday limits in UI and Sammi copy. */
  uvWarning: boolean;
};

/**
 * UV penalties — tuned with feels-like and AQI so 90+ stays rare and ≥13 UV pulls the score down hard.
 */
function uvIndexPenaltyAndWarning(uv: number | null | undefined): {
  penalty: number;
  uvWarning: boolean;
} {
  if (uv == null || !Number.isFinite(uv)) {
    return { penalty: 0, uvWarning: false };
  }
  const u = Number(uv);
  if (u < 8) return { penalty: 0, uvWarning: false };
  if (u < 10) return { penalty: 12, uvWarning: false };
  if (u < 11) return { penalty: 18, uvWarning: false };
  if (u < 13) return { penalty: 28, uvWarning: true };
  return { penalty: 42, uvWarning: true };
}

export function calculateBeachSunScore(
  row: SamuiWeatherForecastRow,
  context?: BeachSunScoreContext | null,
): BeachSunScoreResult {
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

  const { penalty: uvPenalty, uvWarning } = uvIndexPenaltyAndWarning(row.uvIndex);
  score -= uvPenalty;

  const feelsDelta = getFeelsLikeDeltaC(row.temp, row.humidity);
  score -= feelsLikeBeachPenalty(feelsDelta);

  score -= airQualityBeachPenalty(row);

  score = Math.max(5, Math.min(100, Math.round(score)));

  const uvNum = row.uvIndex != null && Number.isFinite(row.uvIndex) ? Number(row.uvIndex) : null;
  const aqi = row.aqi != null && Number.isFinite(row.aqi) ? Number(row.aqi) : null;
  const pm25 = row.pm25 != null && Number.isFinite(row.pm25) ? Number(row.pm25) : null;
  const aqSev = airQualitySeverity(row);

  /** 90+ only when UV, humidity heat, and air are all in a “clean” band */
  if (score >= 90) {
    if (
      (uvNum != null && uvNum > 8) ||
      feelsDelta >= 4 ||
      (aqi != null && aqi > 50) ||
      (pm25 != null && pm25 > 25)
    ) {
      score = Math.min(score, 89);
    }
  }

  /** Extreme UV or very poor air: keep the headline honest */
  if ((uvNum != null && uvNum >= 13) || aqSev >= 3) {
    score = Math.min(score, 59);
  }

  score = Math.max(5, Math.min(100, score));

  let label = '🏖️ Perfect Beach Day';
  let color: BeachSunColor = 'emerald';

  if (score >= 90) {
    // perfect — only after gates above
  } else if (score >= 70) {
    label = '🏝️ Good Beach Day';
    color = 'lime';
  } else if (score >= 60) {
    label = '⛅ Mixed Conditions';
    color = 'amber';
  } else if (score >= 35) {
    label = '🌧️ Marginal';
    color = 'orange';
  } else {
    label = '⛈️ Bad Beach Day';
    color = 'red';
  }

  /** Shared line for hero + Sammi when UV is very high (matches product UV bands ≥ 11). */
  const uvWarningLine = 'Extreme UV — seek shade 12:00–15:00 ICT.';
  const hourlyRows = context?.hourlyRows ?? [];
  const anchorIso = context?.anchorIso ?? row.time;
  const advice = buildContextualBeachAdvice(
    row,
    hourlyRows,
    anchorIso,
    score,
    uvWarning,
    uvWarningLine,
    feelsDelta,
  );

  return { score, label, color, advice, lowCloud: low, ceiling, uvWarning };
}

function pickCinJkg(row: SamuiWeatherForecastRow): number | null {
  if (row.cin != null && Number.isFinite(row.cin)) return row.cin;
  const s = row.sammi?.cinJkg;
  if (s != null && Number.isFinite(s)) return s;
  return null;
}
