/** Web-Mercator helpers at zoom 7 plus small geodesy utilities (port of snw/geo.py). */
import * as C from './config';

const N = 2 ** C.Z * C.TILE; // world size in px

export function lonlatToGpx(lat: number, lon: number): [number, number] {
  const x = ((lon + 180.0) / 360.0) * N;
  const y = ((1.0 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2.0) * N;
  return [x, y];
}

export const ORIGIN_X = C.TILE_X * C.TILE;
export const ORIGIN_Y = C.TILE_Y * C.TILE;
export const KMPX = C.kmPerPx();

export interface PxBox {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

/** Integer pixel slice of the single tile that covers a lat/lon box. */
export function boxPx(box: { latS: number; latN: number; lonW: number; lonE: number }): PxBox {
  const [gx0, gy0] = lonlatToGpx(box.latN, box.lonW);
  const [gx1, gy1] = lonlatToGpx(box.latS, box.lonE);
  const x0 = Math.floor(gx0 - ORIGIN_X);
  const x1 = Math.ceil(gx1 - ORIGIN_X);
  const y0 = Math.floor(gy0 - ORIGIN_Y);
  const y1 = Math.ceil(gy1 - ORIGIN_Y);
  if (x0 < 0 || y0 < 0 || x1 > C.TILE || y1 > C.TILE) throw new Error(`box outside tile ${x0} ${y0} ${x1} ${y1}`);
  return { y0, y1, x0, x1 };
}

/** Bo Phut in tile pixel *index* space (pixel i has its centre at index i). */
export function bophutPx(): [number, number] {
  const [gx, gy] = lonlatToGpx(C.BOPHUT.lat, C.BOPHUT.lon);
  return [gx - ORIGIN_X - 0.5, gy - ORIGIN_Y - 0.5];
}

/** Tile px -> (east_km, north_km) relative to Bo Phut. */
export function pxToKmRel(x: number, y: number, ref: [number, number] = bophutPx()): [number, number] {
  return [(x - ref[0]) * KMPX, -(y - ref[1]) * KMPX];
}

/** Compass bearing (deg clockwise from north) of vector (east, north). */
export function bearingDeg(eastKm: number, northKm: number): number {
  return (((Math.atan2(eastKm, northKm) * 180) / Math.PI) + 360.0) % 360.0;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass16(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return COMPASS[Math.trunc(d / 22.5 + 0.5) % 16];
}

/** Python's round(): half to even (banker's rounding), returns an integer. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
