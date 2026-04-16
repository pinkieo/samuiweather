/** Parse Spire tides JSON (v4: `values` = lijst van { name, value, … }) en trends. */

type TidePoint = { t: number; h: number };

/** Spire v4: zoek in `values[]` het object met name === 'tide_height'. */
export function tideHeightFromValuesV4(values: unknown): number | undefined {
  if (values == null) return undefined;

  if (Array.isArray(values)) {
    for (const item of values) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (o.name === 'tide_height') {
        if (typeof o.value === 'number') return o.value;
        if (typeof o.data === 'number') return o.data;
        if (typeof o.tide_height === 'number') return o.tide_height;
      }
    }
    for (const item of values) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (typeof o.tide_height === 'number') return o.tide_height;
      if (typeof o.height === 'number') return o.height;
    }
    return undefined;
  }

  if (typeof values === 'object') {
    const v = values as Record<string, unknown>;
    if (typeof v.tide_height === 'number') return v.tide_height;
    if (typeof v.height === 'number') return v.height;
    if (typeof v.sea_surface_height_above_mean_sea_level === 'number') {
      return v.sea_surface_height_above_mean_sea_level;
    }
  }
  return undefined;
}

function extractTidePoints(raw: unknown): TidePoint[] {
  if (raw === null || typeof raw !== 'object' || !('data' in raw)) return [];
  const { data } = raw as { data: unknown };
  if (!Array.isArray(data)) return [];

  const out: TidePoint[] = [];
  for (const row of data) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as {
      times?: { valid_time?: string };
      values?: unknown;
    };
    const t = r.times?.valid_time ? Date.parse(r.times.valid_time) : NaN;
    const h = tideHeightFromValuesV4(r.values);
    if (Number.isFinite(t) && h !== undefined) {
      out.push({ t, h });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export type TideTrend = 'rising' | 'falling' | 'steady' | 'unknown';

export function getTideTrend(raw: unknown): TideTrend {
  const pts = extractTidePoints(raw);
  if (pts.length < 2) return 'unknown';

  const now = Date.now();

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.t <= now && now <= b.t) {
      const slope = (b.h - a.h) / (b.t - a.t);
      if (Math.abs(slope) < 1e-12) return 'steady';
      return slope > 0 ? 'rising' : 'falling';
    }
  }

  if (now < pts[0].t) {
    const slope = pts[1].h - pts[0].h;
    if (Math.abs(slope) < 1e-9) return 'steady';
    return slope > 0 ? 'rising' : 'falling';
  }

  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const slope = (b.h - a.h) / (b.t - a.t);
  if (Math.abs(slope) < 1e-12) return 'steady';
  return slope > 0 ? 'rising' : 'falling';
}

/** Eerste uur in `data`: hoogte voor de Tide-widget (m t.o.v. MSL). */
export function getFirstTideHeightM(raw: unknown): number | null {
  if (raw === null || typeof raw !== 'object' || !('data' in raw)) return null;
  const { data } = raw as { data: unknown };
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (first === null || typeof first !== 'object') return null;
  const h = tideHeightFromValuesV4(
    (first as { values?: unknown }).values,
  );
  return typeof h === 'number' && !Number.isNaN(h) ? h : null;
}

/** Advies voor strand (Chaweng/Lamai) op basis van getij-trend en actuele hoogte (m MSL). */
export type BeachAdviseStatus =
  | 'wide_beach'
  | 'beach_disappearing'
  | 'deep_water'
  | 'neutral';

/**
 * Prioriteit: Deep Water (Top 5%) > Beach Disappearing (Top 15% + stijgend) > Wide Beach (< MSL + dalend).
 * Bij ontbrekende hoogte of trend die nodig is voor een regel: `neutral`.
 */
export function getBeachAdvise(
  trend: TideTrend,
  heightM: number | null,
): BeachAdviseStatus {
  if (heightM == null || Number.isNaN(heightM)) return 'neutral';

  // Dynamische drempels voor Samui (berekend over 30-daagse cyclus april 2026):
  // Min: -0.51m | MSL: -0.01m | Max: 0.91m
  const THRESHOLD_DEEP_WATER = 0.64;         // Top 5%
  const THRESHOLD_BEACH_DISAPPEARING = 0.39; // Top 15%
  const THRESHOLD_WIDE_BEACH = 0.0;          // ~ MSL

  if (heightM >= THRESHOLD_DEEP_WATER) return 'deep_water';
  if (heightM >= THRESHOLD_BEACH_DISAPPEARING && trend === 'rising') return 'beach_disappearing';
  if (heightM <= THRESHOLD_WIDE_BEACH && trend === 'falling') return 'wide_beach';
  return 'neutral';
}

export const beachAdviseLabels: Record<
  Exclude<BeachAdviseStatus, 'neutral'>,
  { title: string; hint: string }
> = {
  wide_beach: {
    title: 'Wide Beach',
    hint: 'Ideal for walking and swimming.',
  },
  beach_disappearing: {
    title: 'Narrow Beach',
    hint: 'Chaweng/Lamai beach getting narrow — arrive early.',
  },
  deep_water: {
    title: 'Deep Water',
    hint: 'Little beach left — swim from steps or pier.',
  },
};

/** Next discrete high/low in the Spire tide series after `now` (for UI copy). */
export type NextTideExtremum = {
  kind: 'high' | 'low';
  whenMs: number;
  heightM: number;
};

export function getNextTideExtremum(raw: unknown): NextTideExtremum | null {
  const pts = extractTidePoints(raw);
  if (pts.length < 3) return null;
  const now = Date.now();

  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const isHigh = b.h > a.h && b.h > c.h;
    const isLow = b.h < a.h && b.h < c.h;
    if (!isHigh && !isLow) continue;
    if (b.t <= now) continue;
    return {
      kind: isHigh ? 'high' : 'low',
      whenMs: b.t,
      heightM: b.h,
    };
  }
  return null;
}

/** Human text: height vs mean sea level (MSL), ~cm. */
export function explainTideHeightMsl(m: number): string {
  const cm = Math.round(m * 100);
  const abs = Math.abs(cm);
  if (abs < 5) {
    return 'about average sea level (MSL) — neither extra beach nor extra depth.';
  }
  if (m > 0) {
    return `~${abs} cm above mean sea level — water is higher than average.`;
  }
  return `~${abs} cm below mean sea level — more dry sand / wider beach than average.`;
}
