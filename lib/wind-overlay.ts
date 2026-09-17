/** Windy-look wind overlay (VIP MapLibre raster + particles). Picture only — not dashboard numbers. */

/**
 * Saturated Windy-style cyan at light tropical knots so the field reads on satellite water.
 * Higher stops stay in the VIP green → yellow → orange → red ramp.
 */
export const WIND_OVERLAY_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [40, 150, 255]],
  [4, [24, 210, 236]],
  [8, [20, 214, 150]],
  [12, [48, 204, 88]],
  [18, [210, 220, 48]],
  [24, [242, 214, 58]],
  [32, [252, 140, 40]],
  [48, [220, 52, 52]],
];

export const WIND_CLEAR_BELOW_KN = 0.15;
export const WIND_PIXEL_ALPHA = 220;
export const WIND_RASTER_OPACITY = 0.72;
export const KN_PER_MS = 1.943844492;

export type WindOverlayField = {
  source_label: string;
  units: 'm s**-1';
  width: number;
  height: number;
  west: number;
  south: number;
  east: number;
  north: number;
  u: Array<number | null>;
  v: Array<number | null>;
  /** MSL pressure hPa — isobars. Optional so older caches still work. */
  p?: Array<number | null>;
  /** Shortwave W/m² — sunshine picture. Optional. */
  sw?: Array<number | null>;
  validTime: string | null;
};

export const ISOBAR_HPA_STEP = 2;
export const SUNSHINE_CLEAR_BELOW_WM2 = 40;

export type WindRasterImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
};

export function windColorForKn(kn: number): [number, number, number] {
  const x = Number(kn);
  const first = WIND_OVERLAY_STOPS[0]!;
  const last = WIND_OVERLAY_STOPS[WIND_OVERLAY_STOPS.length - 1]!;
  if (!Number.isFinite(x) || x <= first[0]) return [first[1][0], first[1][1], first[1][2]];
  for (let i = 1; i < WIND_OVERLAY_STOPS.length; i++) {
    const prev = WIND_OVERLAY_STOPS[i - 1]!;
    const next = WIND_OVERLAY_STOPS[i]!;
    if (x <= next[0]) {
      const t = next[0] === prev[0] ? 0 : (x - prev[0]) / (next[0] - prev[0]);
      return [
        Math.round(prev[1][0] + (next[1][0] - prev[1][0]) * t),
        Math.round(prev[1][1] + (next[1][1] - prev[1][1]) * t),
        Math.round(prev[1][2] + (next[1][2] - prev[1][2]) * t),
      ];
    }
  }
  return [last[1][0], last[1][1], last[1][2]];
}

function cellUv(
  field: WindOverlayField,
  x: number,
  y: number,
): { u: number; v: number } | null {
  if (x < 0 || y < 0 || x >= field.width || y >= field.height) return null;
  const idx = y * field.width + x;
  const u = field.u[idx];
  const v = field.v[idx];
  if (u == null || v == null || !Number.isFinite(u) || !Number.isFinite(v)) return null;
  return { u, v };
}

export function sampleUv(
  field: WindOverlayField,
  lon: number,
  lat: number,
): { u: number; v: number } | null {
  if (lat < field.south || lat > field.north || lon < field.west || lon > field.east) return null;
  const spanX = field.east - field.west;
  const spanY = field.north - field.south;
  if (!(spanX > 0) || !(spanY > 0) || field.width < 1 || field.height < 1) return null;
  const fx = ((lon - field.west) / spanX) * Math.max(1, field.width - 1);
  const fy = ((field.north - lat) / spanY) * Math.max(1, field.height - 1);
  const x0 = Math.max(0, Math.min(field.width - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(field.height - 1, Math.floor(fy)));
  const x1 = Math.min(x0 + 1, field.width - 1);
  const y1 = Math.min(y0 + 1, field.height - 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const c00 = cellUv(field, x0, y0);
  const c10 = cellUv(field, x1, y0);
  const c01 = cellUv(field, x0, y1);
  const c11 = cellUv(field, x1, y1);
  const present = [c00, c10, c01, c11].filter((c): c is { u: number; v: number } => c != null);
  if (!present.length) return null;
  if (present.length < 4) {
    const u = present.reduce((s, c) => s + c.u, 0) / present.length;
    const v = present.reduce((s, c) => s + c.v, 0) / present.length;
    return { u, v };
  }
  return {
    u:
      (c00!.u * (1 - tx) + c10!.u * tx) * (1 - ty) +
      (c01!.u * (1 - tx) + c11!.u * tx) * ty,
    v:
      (c00!.v * (1 - tx) + c10!.v * tx) * (1 - ty) +
      (c01!.v * (1 - tx) + c11!.v * tx) * ty,
  };
}

/** Georeferenced colour raster — same contract as VIP `vipWindRasterizeBbox`. */
export function rasterizeWindField(field: WindOverlayField, up = 12): WindRasterImage | null {
  const lonSpan = field.east - field.west;
  const latSpan = field.north - field.south;
  if (!(lonSpan > 0 && latSpan > 0)) return null;
  let width = Math.max(2, Math.round(Math.max(1, field.width - 1) * up) + 1);
  let height = Math.max(2, Math.round(Math.max(1, field.height - 1) * up) + 1);
  const maxPx = 1600;
  if (width > maxPx || height > maxPx) {
    const s = Math.min(maxPx / width, maxPx / height);
    width = Math.max(2, Math.round(width * s));
    height = Math.max(2, Math.round(height * s));
  }
  const data = new Uint8ClampedArray(width * height * 4);
  let usable = 0;
  for (let y = 0; y < height; y++) {
    const lat = field.north - (y / (height - 1)) * latSpan;
    for (let x = 0; x < width; x++) {
      const lon = field.west + (x / (width - 1)) * lonSpan;
      const uv = sampleUv(field, lon, lat);
      const i = (y * width + x) * 4;
      if (!uv) {
        data[i + 3] = 0;
        continue;
      }
      const kn = Math.hypot(uv.u, uv.v) * KN_PER_MS;
      if (kn < WIND_CLEAR_BELOW_KN) {
        data[i + 3] = 0;
        continue;
      }
      const rgb = windColorForKn(kn);
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = kn < 12 ? Math.round(WIND_PIXEL_ALPHA * 0.92) : WIND_PIXEL_ALPHA;
      usable += 1;
    }
  }
  if (usable <= 0) return null;
  return {
    width,
    height,
    data,
    coordinates: [
      [field.west, field.north],
      [field.east, field.north],
      [field.east, field.south],
      [field.west, field.south],
    ],
  };
}

function sampleScalar(
  grid: Array<number | null> | undefined,
  field: WindOverlayField,
  lon: number,
  lat: number,
): number | null {
  if (!grid || grid.length !== field.width * field.height) return null;
  if (lat < field.south || lat > field.north || lon < field.west || lon > field.east) return null;
  const spanX = field.east - field.west;
  const spanY = field.north - field.south;
  if (!(spanX > 0) || !(spanY > 0) || field.width < 2 || field.height < 2) return null;
  const fx = ((lon - field.west) / spanX) * (field.width - 1);
  const fy = ((field.north - lat) / spanY) * (field.height - 1);
  const x0 = Math.max(0, Math.min(field.width - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(field.height - 1, Math.floor(fy)));
  const x1 = Math.min(x0 + 1, field.width - 1);
  const y1 = Math.min(y0 + 1, field.height - 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const corners = [
    grid[y0 * field.width + x0],
    grid[y0 * field.width + x1],
    grid[y1 * field.width + x0],
    grid[y1 * field.width + x1],
  ];
  const present = corners.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  if (!present.length) return null;
  if (present.length < 4) return present.reduce((s, n) => s + n, 0) / present.length;
  return (
    ((corners[0] as number) * (1 - tx) + (corners[1] as number) * tx) * (1 - ty) +
    ((corners[2] as number) * (1 - tx) + (corners[3] as number) * tx) * ty
  );
}

export function samplePressureHpa(field: WindOverlayField, lon: number, lat: number): number | null {
  return sampleScalar(field.p, field, lon, lat);
}

function lonLatAt(field: WindOverlayField, x: number, y: number): [number, number] {
  const lon =
    field.west + (x / Math.max(1, field.width - 1)) * (field.east - field.west);
  const lat =
    field.north - (y / Math.max(1, field.height - 1)) * (field.north - field.south);
  return [lon, lat];
}

function pAt(field: WindOverlayField, x: number, y: number): number | null {
  const n = field.p?.[y * field.width + x];
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function lerpEdge(
  field: WindOverlayField,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  v0: number,
  v1: number,
  level: number,
): [number, number] {
  const t = v1 === v0 ? 0.5 : (level - v0) / (v1 - v0);
  const u = Math.max(0, Math.min(1, t));
  const a = lonLatAt(field, x0, y0);
  const b = lonLatAt(field, x1, y1);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

export type IsobarLine = { hpa: number; points: Array<[number, number]> };

/** Marching-squares isobars on the MSLP grid. Picture only. */
export function contourIsobars(field: WindOverlayField, step = ISOBAR_HPA_STEP): IsobarLine[] {
  const grid = field.p;
  if (!grid || field.width < 2 || field.height < 2) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const n of grid) {
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  if (!Number.isFinite(min) || max - min < 0.2) return [];
  const start = Math.ceil(min / step) * step;
  const out: IsobarLine[] = [];
  for (let level = start; level <= max + 1e-6; level += step) {
    const hpa = Math.round(level * 10) / 10;
    const points: Array<[number, number]> = [];
    for (let y = 0; y < field.height - 1; y++) {
      for (let x = 0; x < field.width - 1; x++) {
        const v00 = pAt(field, x, y);
        const v10 = pAt(field, x + 1, y);
        const v01 = pAt(field, x, y + 1);
        const v11 = pAt(field, x + 1, y + 1);
        if (v00 == null || v10 == null || v01 == null || v11 == null) continue;
        const bits =
          (v00 >= hpa ? 1 : 0) +
          (v10 >= hpa ? 2 : 0) +
          (v11 >= hpa ? 4 : 0) +
          (v01 >= hpa ? 8 : 0);
        if (bits === 0 || bits === 15) continue;
        const top = () => lerpEdge(field, x, y, x + 1, y, v00, v10, hpa);
        const right = () => lerpEdge(field, x + 1, y, x + 1, y + 1, v10, v11, hpa);
        const bottom = () => lerpEdge(field, x, y + 1, x + 1, y + 1, v01, v11, hpa);
        const left = () => lerpEdge(field, x, y, x, y + 1, v00, v01, hpa);
        let a: [number, number] | null = null;
        let b: [number, number] | null = null;
        switch (bits) {
          case 1:
          case 14:
            a = left();
            b = top();
            break;
          case 2:
          case 13:
            a = top();
            b = right();
            break;
          case 4:
          case 11:
            a = right();
            b = bottom();
            break;
          case 8:
          case 7:
            a = left();
            b = bottom();
            break;
          case 3:
          case 12:
            a = left();
            b = right();
            break;
          case 6:
          case 9:
            a = top();
            b = bottom();
            break;
          case 5:
          case 10:
            a = left();
            b = top();
            break;
          default:
            break;
        }
        if (a && b) {
          points.push(a, b);
        }
      }
    }
    if (points.length >= 2) out.push({ hpa, points });
  }
  return out;
}

/** Warm sunshine wash — picture only, not a second temperature source. */
export function rasterizeSunshine(field: WindOverlayField, up = 8): WindRasterImage | null {
  if (!field.sw?.length) return null;
  const lonSpan = field.east - field.west;
  const latSpan = field.north - field.south;
  if (!(lonSpan > 0 && latSpan > 0)) return null;
  let width = Math.max(2, Math.round(Math.max(1, field.width - 1) * up) + 1);
  let height = Math.max(2, Math.round(Math.max(1, field.height - 1) * up) + 1);
  const maxPx = 1200;
  if (width > maxPx || height > maxPx) {
    const s = Math.min(maxPx / width, maxPx / height);
    width = Math.max(2, Math.round(width * s));
    height = Math.max(2, Math.round(height * s));
  }
  const data = new Uint8ClampedArray(width * height * 4);
  let usable = 0;
  for (let y = 0; y < height; y++) {
    const lat = field.north - (y / (height - 1)) * latSpan;
    for (let x = 0; x < width; x++) {
      const lon = field.west + (x / (width - 1)) * lonSpan;
      const sw = sampleScalar(field.sw, field, lon, lat);
      const i = (y * width + x) * 4;
      if (sw == null || sw < SUNSHINE_CLEAR_BELOW_WM2) {
        data[i + 3] = 0;
        continue;
      }
      const t = Math.max(0, Math.min(1, (sw - SUNSHINE_CLEAR_BELOW_WM2) / 860));
      data[i] = Math.round(255);
      data[i + 1] = Math.round(196 + 40 * t);
      data[i + 2] = Math.round(40 + 20 * (1 - t));
      data[i + 3] = Math.round(28 + 70 * t);
      usable += 1;
    }
  }
  if (usable <= 0) return null;
  return {
    width,
    height,
    data,
    coordinates: [
      [field.west, field.north],
      [field.east, field.north],
      [field.east, field.south],
      [field.west, field.south],
    ],
  };
}
