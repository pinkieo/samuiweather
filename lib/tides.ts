/** Parse Spire tides JSON (v4: `values` = lijst van { name, value, … }) en trends. */

type TidePoint = { t: number; h: number };

function numberFromRecord(o: Record<string, unknown>): number | undefined {
  if (typeof o.value === 'number') return o.value;
  if (typeof o.data === 'number') return o.data;
  if (typeof o.tide_height === 'number') return o.tide_height;
  if (typeof o.height === 'number') return o.height;
  return undefined;
}

/** Spire v4: `values[]` met `{ name, value }` of varianten per regio/bundel. */
export function tideHeightFromValuesV4(values: unknown): number | undefined {
  if (values == null) return undefined;

  if (Array.isArray(values)) {
    for (const item of values) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (o.name === 'tide_height') {
        const n = numberFromRecord(o);
        if (n !== undefined) return n;
      }
    }
    for (const item of values) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const nm = String(o.name ?? '').toLowerCase();
      if (
        nm.includes('tide_height') ||
        nm.includes('sea_surface_height') ||
        nm.includes('sea level') ||
        nm.includes('sea_level') ||
        nm.includes('water_level') ||
        nm.includes('ssh') ||
        nm.includes('sea surface')
      ) {
        const n = numberFromRecord(o);
        if (n !== undefined) return n;
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
    if (typeof v.sea_surface_height === 'number') return v.sea_surface_height;
    if (typeof v.water_level === 'number') return v.water_level;
  }
  return undefined;
}

/**
 * Spire often sends `valid_time` without a timezone suffix but means UTC.
 * Parsing as "local" breaks ordering vs Open-Meteo; some engines yield NaN for edge strings.
 */
function parseTideValidTimeToMs(s: string): number {
  const t = s.trim();
  if (t.length === 0) return NaN;
  if (/[zZ]$/.test(t) || /[+-]\d{2}:?\d{2}(:\d{2})?$/.test(t)) {
    return Date.parse(t);
  }
  const isoNoZone = t.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(\.\d+)?$/,
  );
  if (isoNoZone) {
    const base = isoNoZone[1];
    const frac = isoNoZone[2] ?? '';
    return Date.parse(`${base}${frac}Z`);
  }
  return Date.parse(t);
}

function validTimeMsFromRow(row: Record<string, unknown>): number {
  const times = row.times;
  if (times && typeof times === 'object') {
    const o = times as Record<string, unknown>;
    for (const k of ['valid_time', 'valid', 'time', 'forecast_time']) {
      const v = o[k];
      if (typeof v === 'string') {
        const ms = parseTideValidTimeToMs(v);
        if (Number.isFinite(ms)) return ms;
      }
    }
  }
  for (const k of ['valid_time', 'time', 'forecast_time']) {
    const v = row[k];
    if (typeof v === 'string') {
      const ms = parseTideValidTimeToMs(v);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return NaN;
}

function dedupeTidePointsByTime(pts: TidePoint[]): TidePoint[] {
  if (pts.length < 2) return pts;
  const sorted = [...pts].sort((a, b) => a.t - b.t);
  const out: TidePoint[] = [];
  for (const p of sorted) {
    if (out.length && out[out.length - 1].t === p.t) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

function extractTidePoints(raw: unknown): TidePoint[] {
  if (raw === null || typeof raw !== 'object' || !('data' in raw)) return [];
  const { data } = raw as { data: unknown };
  if (!Array.isArray(data)) return [];

  const out: TidePoint[] = [];
  for (const row of data) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const t = validTimeMsFromRow(r);
    const h = tideHeightFromValuesV4(r.values);
    if (Number.isFinite(t) && h !== undefined) {
      out.push({ t, h });
    }
  }
  return dedupeTidePointsByTime(out);
}

/** Enough hourly samples for trend + height interpolation. */
export function getTideSampleCount(raw: unknown): number {
  return extractTidePoints(raw).length;
}

export function isTideResponseUsable(raw: unknown): boolean {
  return getTideSampleCount(raw) >= 2;
}

/** Set on `/api/tides` when Open-Meteo marine fallback is used (Spire missing/empty). */
export type TideDataSource = 'spire' | 'open-meteo-marine' | 'unknown';

export function getTideDataSource(raw: unknown): TideDataSource {
  if (raw === null || typeof raw !== 'object') return 'unknown';
  const ts = (raw as { _meta?: { tideSource?: string } })._meta?.tideSource;
  if (ts === 'open-meteo-marine') return 'open-meteo-marine';
  if (Array.isArray((raw as { data?: unknown }).data)) return 'spire';
  return 'unknown';
}

export type TideTrend = 'rising' | 'falling' | 'steady' | 'unknown';

type TideExtremum = { t: number; h: number; kind: 'high' | 'low' };

/**
 * Lokale hoog/laag op het uur-grid. Optioneel: **prominentie** (m) om ruis te negeren —
 * anders ontstaan valse “laagwaters” 30–60 min na een piek (Spire-discretisatie).
 */
function enumerateTideExtrema(
  pts: TidePoint[],
  minProminenceM: number = 0,
): TideExtremum[] {
  const out: TideExtremum[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    if (b.h > a.h && b.h > c.h) {
      const prom = Math.min(b.h - a.h, b.h - c.h);
      if (prom < minProminenceM) continue;
      out.push({ t: b.t, h: b.h, kind: 'high' });
    } else if (b.h < a.h && b.h < c.h) {
      const prom = Math.min(a.h - b.h, c.h - b.h);
      if (prom < minProminenceM) continue;
      out.push({ t: b.t, h: b.h, kind: 'low' });
    }
  }
  return out;
}

/** Eerst strikter (minder valse extrema); daarna losser zodat vlak getij nog werkt. */
function enumerateTideExtremaTiers(pts: TidePoint[]): TideExtremum[] {
  for (const minPm of [0.07, 0.045, 0.02, 0]) {
    const e = enumerateTideExtrema(pts, minPm);
    if (e.length > 0) return e;
  }
  return [];
}

/** ~25 min rond hoog/laagwater = slack (segment-slope zou anders “eb” tonen terwijl je visueel nog bij de piek zit). */
const TIDE_SLACK_MS = 25 * 60 * 1000;

function tideTrendFromSegmentSlope(pts: TidePoint[], now: number): TideTrend {
  /**
   * Halfopen intervallen [a,b) behalve het laatste segment [a,b]:
   * zo valt `now` exact op een uur-grid na een hoogwater in het segment *na* de piek
   * (dalend), niet in het segment ernaartoe (stijgend).
   */
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const isLastSeg = i === pts.length - 2;
    const inSeg = isLastSeg
      ? a.t <= now && now <= b.t
      : a.t <= now && now < b.t;
    if (!inSeg) continue;
    const slope = (b.h - a.h) / (b.t - a.t);
    if (Math.abs(slope) < 1e-12) return 'steady';
    return slope > 0 ? 'rising' : 'falling';
  }

  if (now < pts[0].t) {
    const slope = pts[1].h - pts[0].h;
    if (Math.abs(slope) < 1e-9) return 'steady';
    return slope > 0 ? 'rising' : 'falling';
  }

  if (now > pts[pts.length - 1].t) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const slope = (b.h - a.h) / (b.t - a.t);
    if (Math.abs(slope) < 1e-12) return 'steady';
    return slope > 0 ? 'rising' : 'falling';
  }

  return 'unknown';
}

/**
 * Trend op basis van **fase tussen opeenvolgende hoog- en laagwaters** (niet alleen helling tussen twee uurpunkten).
 * Voorkomt “eb” vlak vóór een piek wanneer het segment al licht daalt terwijl je nog naar hoogwater toe zit.
 */
export function getTideTrend(raw: unknown): TideTrend {
  const pts = extractTidePoints(raw);
  if (pts.length < 2) return 'unknown';

  const now = Date.now();
  const extrema = pts.length >= 3 ? enumerateTideExtremaTiers(pts) : [];

  for (const e of extrema) {
    if (Math.abs(e.t - now) <= TIDE_SLACK_MS) return 'steady';
  }

  if (extrema.length >= 1) {
    const lastBefore = extrema.filter(e => e.t <= now).pop() ?? null;
    const nextAfter = extrema.find(e => e.t > now) ?? null;

    if (lastBefore && nextAfter) {
      if (lastBefore.kind === 'low' && nextAfter.kind === 'high') return 'rising';
      if (lastBefore.kind === 'high' && nextAfter.kind === 'low') return 'falling';
    }

    if (!lastBefore && nextAfter) {
      if (nextAfter.kind === 'high') return 'rising';
      if (nextAfter.kind === 'low') return 'falling';
    }

    if (lastBefore && !nextAfter) {
      return tideTrendFromSegmentSlope(pts, now);
    }
  }

  return tideTrendFromSegmentSlope(pts, now);
}

/**
 * Waterstand op `atMs` (lineair tussen Spire-uurpunkten). Gebruik dit voor de UI — **niet** `data[0]`,
 * want het eerste punt is niet per se “nu”.
 */
export function getTideHeightAtNow(raw: unknown, atMs: number = Date.now()): number | null {
  const pts = extractTidePoints(raw);
  if (pts.length === 0) return null;
  if (pts.length === 1) return pts[0].h;

  if (atMs <= pts[0].t) return pts[0].h;
  if (atMs >= pts[pts.length - 1].t) return pts[pts.length - 1].h;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const isLastSeg = i === pts.length - 2;
    const inSeg = isLastSeg
      ? a.t <= atMs && atMs <= b.t
      : a.t <= atMs && atMs < b.t;
    if (!inSeg) continue;
    const w = (atMs - a.t) / (b.t - a.t);
    return a.h + w * (b.h - a.h);
  }

  return null;
}

/**
 * @deprecated Gebruik {@link getTideHeightAtNow} — eerste rij is niet het actuele tijdstip.
 * Blijft als alias voor oude callers.
 */
export function getFirstTideHeightM(raw: unknown): number | null {
  return getTideHeightAtNow(raw);
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
  const hNow = getTideHeightAtNow(raw, now);

  const ex = enumerateTideExtremaTiers(pts);
  /** ~bovenkant getij; alleen hier: negeer “laag” die nauwelijks onder actuele piek zit (uur-grid ruis). */
  const HIGH_WATER_BAND_M = 0.52;
  const SHALLOW_DIP_M = 0.14;

  for (const e of ex) {
    if (e.t <= now) continue;

    if (
      e.kind === 'low' &&
      hNow != null &&
      hNow >= HIGH_WATER_BAND_M &&
      e.t - now < 3 * 60 * 60 * 1000 &&
      hNow - e.h < SHALLOW_DIP_M
    ) {
      continue;
    }

    return { kind: e.kind, whenMs: e.t, heightM: e.h };
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
