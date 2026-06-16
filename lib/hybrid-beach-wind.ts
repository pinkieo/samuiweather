import { bearingDeg } from '@/lib/rainviewer-cell-motion';

export type BeachRainMotionHint = 'towards_coast' | 'out_to_sea' | 'alongshore';

/** Rough open-water reference for “toward sea” from a beach pin (not survey-grade). */
export function openWaterAnchor(product: 'samui' | 'krabi'): { lat: number; lon: number } {
  if (product === 'samui') {
    return { lat: 10.12, lon: 100.02 }; // Gulf of Thailand N/NW of Ko Samui
  }
  return { lat: 7.35, lon: 98.25 }; // Andaman SW of Krabi/Ao Nang coast
}

export function bearingFromPinToOpenWaterDeg(
  lat: number,
  lon: number,
  product: 'samui' | 'krabi',
): number {
  const t = openWaterAnchor(product);
  return bearingDeg(lat, lon, t.lat, t.lon);
}

/** Air motion / shower advection (° clockwise from N) from met wind **from** direction. */
export function windTowardDegFromMetFrom(windFromDeg: number): number {
  return (windFromDeg + 180 + 360) % 360;
}

function smallestAngleDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Classify motion vs local sea/land orientation for resort safety copy.
 * Uses wind **toward** vs bearing pin→open water.
 */
export function beachRainMotionHint(
  windFromDeg: number,
  lat: number,
  lon: number,
  product: 'samui' | 'krabi',
): BeachRainMotionHint {
  const toward = windTowardDegFromMetFrom(windFromDeg);
  const toSea = bearingFromPinToOpenWaterDeg(lat, lon, product);
  const toLand = (toSea + 180) % 360;
  const dLand = smallestAngleDiffDeg(toward, toLand);
  const dSea = smallestAngleDiffDeg(toward, toSea);
  if (dLand < 45) return 'towards_coast';
  if (dSea < 45) return 'out_to_sea';
  return 'alongshore';
}

export function beachRainMotionEnglish(hint: BeachRainMotionHint): string {
  switch (hint) {
    case 'towards_coast':
      return 'Towards coast / inland';
    case 'out_to_sea':
      return 'Out to sea';
    default:
      return 'Along the beach / parallel to shore';
  }
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Meteorological wind **from** direction (8-pt). */
export function windFromCardinal8(windFromDeg: number): string {
  const d = ((windFromDeg % 360) + 360) % 360;
  const ix = Math.floor((d + 22.5) / 45) % 8;
  return CARDINALS[ix] ?? 'N';
}

export function formatWindKmHFromRow(windSpeedMs: number, windFromDeg: number): string {
  const kmh = Math.round(Math.max(0, windSpeedMs) * 3.6);
  return `${windFromCardinal8(windFromDeg)} ${kmh} km/h`;
}
