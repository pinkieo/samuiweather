/** Parse Spire tides JSON en bepaal of water stijgt of daalt rond nu. */

type TidePoint = { t: number; h: number };

function extractTidePoints(raw: unknown): TidePoint[] {
  if (raw === null || typeof raw !== 'object' || !('data' in raw)) return [];
  const { data } = raw as { data: unknown };
  if (!Array.isArray(data)) return [];

  const out: TidePoint[] = [];
  for (const row of data) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as {
      times?: { valid_time?: string };
      values?: Record<string, unknown>;
    };
    const t = r.times?.valid_time ? Date.parse(r.times.valid_time) : NaN;
    const v = r.values ?? {};
    let h: number | undefined;
    if (typeof v.tide_height === 'number') h = v.tide_height;
    else if (typeof v.height === 'number') h = v.height;
    else if (typeof v.sea_surface_height_above_mean_sea_level === 'number') {
      h = v.sea_surface_height_above_mean_sea_level;
    }
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
