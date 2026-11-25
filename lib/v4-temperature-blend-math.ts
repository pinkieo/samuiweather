/**
 * Samui v4 temperature blend (pure math, zero side effects).
 *
 * 50/50 blend of bias-corrected Spire point forecast and bias-corrected
 * Open-Meteo ECMWF IFS 0.25° (`ecmwf_ifs025`), using a trailing 30-day
 * walk-forward bias correction against Baan Ton Kluay Ecowitt observations.
 *
 * - Daily high (`hi`): Spire max over ICT 10:00–17:59; ECMWF & Ecowitt max over 24h ICT day.
 * - Daily low (`lo`): 24h ICT day min for Spire, ECMWF, and Ecowitt.
 * - Bias = mean(observed - forecast) over trailing 30 valid completed ICT days.
 * - Rain amounts are intentionally excluded.
 */

export const V4_BLEND_MODEL_ID = 'v4-spire-ecmwf-50-50-30d-bias';
export const V4_BIAS_WINDOW_DAYS = 30;
export const V4_MIN_ECOWITT_SAMPLES = 700;
export const V4_MAX_FIRST_MINUTE_ICT = 90;
export const V4_MIN_LAST_MINUTE_ICT = 1380;

export type DailyObservationTemp = {
  date: string; // YYYY-MM-DD ICT
  obsHiC: number;
  obsLoC: number;
  sampleCount: number;
  firstMinuteIct: number;
  lastMinuteIct: number;
};

export type DailyModelTemp = {
  date: string; // YYYY-MM-DD ICT
  hiC: number;
  loC: number;
  hoursCount: number;
};

export type HistoricalTempPair = {
  date: string; // YYYY-MM-DD ICT
  obsHiC: number;
  obsLoC: number;
  spireHiC: number;
  spireLoC: number;
  ecmwfHiC: number;
  ecmwfLoC: number;
};

export type V4TrailingBiases = {
  windowDays: number;
  samplesUsed: number;
  windowFrom: string | null;
  windowTo: string | null;
  spireHiBiasC: number | null;
  spireLoBiasC: number | null;
  ecmwfHiBiasC: number | null;
  ecmwfLoBiasC: number | null;
};

export type V4DailyTempForecast = {
  date: string; // YYYY-MM-DD ICT
  spireRawHiC: number | null;
  spireRawLoC: number | null;
  spireBiasCorrectedHiC: number | null;
  spireBiasCorrectedLoC: number | null;
  ecmwfRawHiC: number | null;
  ecmwfRawLoC: number | null;
  ecmwfBiasCorrectedHiC: number | null;
  ecmwfBiasCorrectedLoC: number | null;
  blendHiC: number | null;
  blendLoC: number | null;
  spireHoursCount: number;
  spireDaytimeHoursCount: number;
  ecmwfHoursCount: number;
};

export type V4TemperatureBlendSummary = {
  available: boolean;
  model: typeof V4_BLEND_MODEL_ID;
  timezone: 'Asia/Bangkok';
  ecmwfModel: 'ecmwf_ifs025';
  ecmwfGrid: {
    lat: number;
    lon: number;
    elevationM: number | null;
  };
  biasesC: V4TrailingBiases;
  daily: V4DailyTempForecast[];
  error?: string;
};

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function parseUtcMs(raw: string): number | null {
  let s = raw.trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) {
    s = `${s}:00Z`;
  } else if (/[+-]\d{2}$/.test(s)) {
    s = `${s}:00`;
  } else if (!s.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(s)) {
    s = `${s}Z`;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

export function canonicalUtcHourIso(raw: string): string | null {
  const ms = parseUtcMs(raw);
  if (ms === null) return null;
  const bucket = Math.floor(ms / 3_600_000) * 3_600_000;
  return new Date(bucket).toISOString();
}

export function ictDateFromUtcIso(iso: string): string | null {
  const ms = parseUtcMs(iso);
  if (ms === null) return null;
  // Asia/Bangkok is fixed UTC+7 (no DST)
  const shifted = new Date(ms + 7 * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

export function ictHourFromUtcIso(iso: string): number | null {
  const ms = parseUtcMs(iso);
  if (ms === null) return null;
  const shifted = new Date(ms + 7 * 3_600_000);
  return shifted.getUTCHours();
}

export function isEcowittTempDayValid(obs: {
  sampleCount: number;
  firstMinuteIct: number;
  lastMinuteIct: number;
}): boolean {
  return (
    obs.sampleCount >= V4_MIN_ECOWITT_SAMPLES &&
    obs.firstMinuteIct <= V4_MAX_FIRST_MINUTE_ICT &&
    obs.lastMinuteIct >= V4_MIN_LAST_MINUTE_ICT
  );
}

export function computeTrailingBiases(
  pairs: HistoricalTempPair[],
  beforeDateIct: string,
  windowDays: number = V4_BIAS_WINDOW_DAYS,
): V4TrailingBiases {
  const eligible = pairs
    .filter(
      (p) =>
        p.date < beforeDateIct &&
        isFiniteNum(p.obsHiC) &&
        isFiniteNum(p.obsLoC) &&
        isFiniteNum(p.spireHiC) &&
        isFiniteNum(p.spireLoC) &&
        isFiniteNum(p.ecmwfHiC) &&
        isFiniteNum(p.ecmwfLoC),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-windowDays);

  if (eligible.length === 0) {
    return {
      windowDays,
      samplesUsed: 0,
      windowFrom: null,
      windowTo: null,
      spireHiBiasC: null,
      spireLoBiasC: null,
      ecmwfHiBiasC: null,
      ecmwfLoBiasC: null,
    };
  }

  const mean = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
  return {
    windowDays,
    samplesUsed: eligible.length,
    windowFrom: eligible[0]!.date,
    windowTo: eligible[eligible.length - 1]!.date,
    spireHiBiasC: round2(mean(eligible.map((p) => p.obsHiC - p.spireHiC))),
    spireLoBiasC: round2(mean(eligible.map((p) => p.obsLoC - p.spireLoC))),
    ecmwfHiBiasC: round2(mean(eligible.map((p) => p.obsHiC - p.ecmwfHiC))),
    ecmwfLoBiasC: round2(mean(eligible.map((p) => p.obsLoC - p.ecmwfLoC))),
  };
}

export function computeBlendDailyEntry(args: {
  date: string;
  spireHours: Array<{ timeUtc: string; tempC: number }>;
  ecmwfHours: Array<{ timeUtc: string; tempC: number }>;
  biases: V4TrailingBiases;
}): V4DailyTempForecast {
  const { date, spireHours, ecmwfHours, biases } = args;

  const spDaytime = spireHours.filter((h) => {
    const hr = ictHourFromUtcIso(h.timeUtc);
    return hr !== null && hr >= 10 && hr <= 17 && isFiniteNum(h.tempC);
  });
  const spAll = spireHours.filter((h) => isFiniteNum(h.tempC));
  const ecAll = ecmwfHours.filter((h) => isFiniteNum(h.tempC));

  const spireRawHiC =
    spDaytime.length > 0
      ? round2(Math.max(...spDaytime.map((h) => h.tempC)))
      : null;
  const spireRawLoC =
    spAll.length > 0 ? round2(Math.min(...spAll.map((h) => h.tempC))) : null;

  const ecmwfRawHiC =
    ecAll.length === 24 ? round2(Math.max(...ecAll.map((h) => h.tempC))) : null;
  const ecmwfRawLoC =
    ecAll.length === 24 ? round2(Math.min(...ecAll.map((h) => h.tempC))) : null;

  const spireBiasCorrectedHiC =
    spireRawHiC !== null && isFiniteNum(biases.spireHiBiasC)
      ? round2(spireRawHiC + biases.spireHiBiasC)
      : null;
  const spireBiasCorrectedLoC =
    spireRawLoC !== null && isFiniteNum(biases.spireLoBiasC)
      ? round2(spireRawLoC + biases.spireLoBiasC)
      : null;

  const ecmwfBiasCorrectedHiC =
    ecmwfRawHiC !== null && isFiniteNum(biases.ecmwfHiBiasC)
      ? round2(ecmwfRawHiC + biases.ecmwfHiBiasC)
      : null;
  const ecmwfBiasCorrectedLoC =
    ecmwfRawLoC !== null && isFiniteNum(biases.ecmwfLoBiasC)
      ? round2(ecmwfRawLoC + biases.ecmwfLoBiasC)
      : null;

  const blendHiC =
    spireBiasCorrectedHiC !== null && ecmwfBiasCorrectedHiC !== null
      ? round2(0.5 * spireBiasCorrectedHiC + 0.5 * ecmwfBiasCorrectedHiC)
      : null;
  const blendLoC =
    spireBiasCorrectedLoC !== null && ecmwfBiasCorrectedLoC !== null
      ? round2(0.5 * spireBiasCorrectedLoC + 0.5 * ecmwfBiasCorrectedLoC)
      : null;

  return {
    date,
    spireRawHiC,
    spireRawLoC,
    spireBiasCorrectedHiC,
    spireBiasCorrectedLoC,
    ecmwfRawHiC,
    ecmwfRawLoC,
    ecmwfBiasCorrectedHiC,
    ecmwfBiasCorrectedLoC,
    blendHiC,
    blendLoC,
    spireHoursCount: spAll.length,
    spireDaytimeHoursCount: spDaytime.length,
    ecmwfHoursCount: ecAll.length,
  };
}

export function computeHourlyBlendTemp(args: {
  spireTempC: number | null | undefined;
  ecmwfTempC: number | null | undefined;
  ictHour: number | null;
  biases: V4TrailingBiases;
}): { ecmwfTempRawC: number | null; tempBlendC: number | null } {
  const { spireTempC, ecmwfTempC, ictHour, biases } = args;
  const ecmwfTempRawC = isFiniteNum(ecmwfTempC) ? round1(ecmwfTempC) : null;
  if (!isFiniteNum(spireTempC) || ecmwfTempRawC === null || ictHour === null) {
    return { ecmwfTempRawC, tempBlendC: null };
  }
  const isDaytime = ictHour >= 10 && ictHour <= 17;
  const spBias = isDaytime ? biases.spireHiBiasC : biases.spireLoBiasC;
  const ecBias = isDaytime ? biases.ecmwfHiBiasC : biases.ecmwfLoBiasC;
  if (!isFiniteNum(spBias) || !isFiniteNum(ecBias)) {
    return { ecmwfTempRawC, tempBlendC: null };
  }
  const blended = 0.5 * (spireTempC + spBias) + 0.5 * (ecmwfTempRawC + ecBias);
  return { ecmwfTempRawC, tempBlendC: round1(blended) };
}

export function walkForwardReplay(
  pairs: HistoricalTempPair[],
  fromDateIct: string,
  toDateIct: string,
  windowDays: number = V4_BIAS_WINDOW_DAYS,
): {
  days: Array<
    HistoricalTempPair & {
      biases: V4TrailingBiases;
      spireBcHiC: number;
      ecmwfBcHiC: number;
      blendHiC: number;
      spireBcLoC: number;
      ecmwfBcLoC: number;
      blendLoC: number;
    }
  >;
  metrics: {
    n: number;
    max: {
      rawSpireBiasC: number;
      rawSpireMaeC: number;
      spireBcBiasC: number;
      spireBcMaeC: number;
      ecmwfBcBiasC: number;
      ecmwfBcMaeC: number;
      blendBiasC: number;
      blendMaeC: number;
    };
    min: {
      rawSpireBiasC: number;
      rawSpireMaeC: number;
      spireBcBiasC: number;
      spireBcMaeC: number;
      ecmwfBcBiasC: number;
      ecmwfBcMaeC: number;
      blendBiasC: number;
      blendMaeC: number;
    };
  };
} {
  const sorted = [...pairs].sort((a, b) => a.date.localeCompare(b.date));
  const out: Array<
    HistoricalTempPair & {
      biases: V4TrailingBiases;
      spireBcHiC: number;
      ecmwfBcHiC: number;
      blendHiC: number;
      spireBcLoC: number;
      ecmwfBcLoC: number;
      blendLoC: number;
    }
  > = [];

  for (const row of sorted) {
    if (row.date < fromDateIct || row.date > toDateIct) continue;
    const biases = computeTrailingBiases(sorted, row.date, windowDays);
    if (
      biases.samplesUsed === 0 ||
      biases.spireHiBiasC === null ||
      biases.ecmwfHiBiasC === null ||
      biases.spireLoBiasC === null ||
      biases.ecmwfLoBiasC === null
    ) {
      continue;
    }
    const spireBcHiC = row.spireHiC + biases.spireHiBiasC;
    const ecmwfBcHiC = row.ecmwfHiC + biases.ecmwfHiBiasC;
    const blendHiC = 0.5 * spireBcHiC + 0.5 * ecmwfBcHiC;
    const spireBcLoC = row.spireLoC + biases.spireLoBiasC;
    const ecmwfBcLoC = row.ecmwfLoC + biases.ecmwfLoBiasC;
    const blendLoC = 0.5 * spireBcLoC + 0.5 * ecmwfBcLoC;
    out.push({
      ...row,
      biases,
      spireBcHiC,
      ecmwfBcHiC,
      blendHiC,
      spireBcLoC,
      ecmwfBcLoC,
      blendLoC,
    });
  }

  const stat = (preds: number[], obs: number[]) => {
    const errs = preds.map((p, i) => p - obs[i]!);
    const n = errs.length || 1;
    return {
      biasC: round2(errs.reduce((s, e) => s + e, 0) / n),
      maeC: round2(errs.reduce((s, e) => s + Math.abs(e), 0) / n),
    };
  };

  const obsHi = out.map((d) => d.obsHiC);
  const obsLo = out.map((d) => d.obsLoC);
  const rawHi = stat(out.map((d) => d.spireHiC), obsHi);
  const spBcHi = stat(out.map((d) => d.spireBcHiC), obsHi);
  const ecBcHi = stat(out.map((d) => d.ecmwfBcHiC), obsHi);
  const blHi = stat(out.map((d) => d.blendHiC), obsHi);
  const rawLo = stat(out.map((d) => d.spireLoC), obsLo);
  const spBcLo = stat(out.map((d) => d.spireBcLoC), obsLo);
  const ecBcLo = stat(out.map((d) => d.ecmwfBcLoC), obsLo);
  const blLo = stat(out.map((d) => d.blendLoC), obsLo);

  return {
    days: out,
    metrics: {
      n: out.length,
      max: {
        rawSpireBiasC: rawHi.biasC,
        rawSpireMaeC: rawHi.maeC,
        spireBcBiasC: spBcHi.biasC,
        spireBcMaeC: spBcHi.maeC,
        ecmwfBcBiasC: ecBcHi.biasC,
        ecmwfBcMaeC: ecBcHi.maeC,
        blendBiasC: blHi.biasC,
        blendMaeC: blHi.maeC,
      },
      min: {
        rawSpireBiasC: rawLo.biasC,
        rawSpireMaeC: rawLo.maeC,
        spireBcBiasC: spBcLo.biasC,
        spireBcMaeC: spBcLo.maeC,
        ecmwfBcBiasC: ecBcLo.biasC,
        ecmwfBcMaeC: ecBcLo.maeC,
        blendBiasC: blLo.biasC,
        blendMaeC: blLo.maeC,
      },
    },
  };
}
