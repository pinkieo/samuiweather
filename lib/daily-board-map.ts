/**
 * Koh Samui silhouette for the daily board. Geographic outline, not a forecast.
 * Shore rectangles are clipped to this outline. Colour comes from each coast's
 * own Spire rain rate, not from the single stored island point.
 */

import { BAAN_TON_KLUAY_WGS84 } from '@/lib/dashboard-regions';
import type { BoardRegionId } from '@/lib/daily-board';

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

/**
 * Lat/lon boxes that tile the island. The SVG clips them to the coast outline.
 * Anchors are the Spire point reads for that shore (not stored as history).
 */
export const COAST_ANCHORS: Record<BoardRegionId, { lat: number; lon: number; label: string }> = {
  north: { lat: 9.575, lon: 100.02, label: 'Mae Nam' },
  east: { lat: 9.52, lon: 100.075, label: 'Chaweng' },
  south: { lat: 9.44, lon: 100.01, label: 'Lamai' },
  west: { lat: 9.51, lon: 99.96, label: 'Lipa Noi' },
};

const REGION_BOX: Record<BoardRegionId, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  north: { latMin: 9.55, latMax: 9.7, lonMin: 99.85, lonMax: 100.2 },
  east: { latMin: 9.48, latMax: 9.55, lonMin: 100.03, lonMax: 100.2 },
  south: { latMin: 9.3, latMax: 9.48, lonMin: 99.85, lonMax: 100.2 },
  west: { latMin: 9.48, latMax: 9.55, lonMin: 99.85, lonMax: 100.03 },
};

/** Rectangle covering one shore. Overlaps by a pixel so the clip has no gaps. */
export function regionRectPath(id: BoardRegionId): string {
  const box = REGION_BOX[id];
  const nw = projectIsland(box.latMax, box.lonMin);
  const se = projectIsland(box.latMin, box.lonMax);
  const x = Math.min(nw.x, se.x) - 1;
  const y = Math.min(nw.y, se.y) - 1;
  const w = Math.abs(se.x - nw.x) + 2;
  const h = Math.abs(se.y - nw.y) + 2;
  return `M${x} ${y} h${w} v${h} h${-w} Z`;
}
