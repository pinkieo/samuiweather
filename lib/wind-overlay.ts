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
  validTime: string | null;
};

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
