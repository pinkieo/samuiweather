/**
 * Koh Samui silhouette for the daily board. Geographic outline, not a forecast.
 * Shower colour is applied by the caller from the island forecast point.
 */

import { BAAN_TON_KLUAY_WGS84 } from '@/lib/dashboard-regions';

export const ISLAND_BOUNDS = {
  north: 9.62,
  south: 9.37,
  west: 99.91,
  east: 100.12,
} as const;

export const MAP_W = 160;
export const MAP_H = 220;

/** [lat, lon] clockwise from the north coast. A simple guest outline. */
export const ISLAND_COAST: ReadonlyArray<readonly [number, number]> = [
  [9.595, 100.02],
  [9.58, 100.055],
  [9.555, 100.085],
  [9.53, 100.095],
  [9.505, 100.078],
  [9.478, 100.062],
  [9.45, 100.04],
  [9.42, 100.015],
  [9.398, 99.995],
  [9.412, 99.968],
  [9.45, 99.938],
  [9.49, 99.942],
  [9.53, 99.958],
  [9.568, 99.988],
  [9.595, 100.02],
];

export function projectIsland(lat: number, lon: number): { x: number; y: number } {
  const x =
    ((lon - ISLAND_BOUNDS.west) / (ISLAND_BOUNDS.east - ISLAND_BOUNDS.west)) * MAP_W;
  const y =
    ((ISLAND_BOUNDS.north - lat) / (ISLAND_BOUNDS.north - ISLAND_BOUNDS.south)) * MAP_H;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

export function islandPath(): string {
  return (
    ISLAND_COAST.map((point, index) => {
      const { x, y } = projectIsland(point[0], point[1]);
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
    }).join(' ') + ' Z'
  );
}

export const GARDEN_STATION = projectIsland(
  BAAN_TON_KLUAY_WGS84.lat,
  BAAN_TON_KLUAY_WGS84.lon,
);
