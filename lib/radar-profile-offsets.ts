/** Lat/lon offsets (deg) for “nearby cell” sampling — align with server-side conflict-status ring (lighter on client). */

export const RADAR_PROFILE_OFFSETS_KRABI: [number, number][] = [
  [0, 0],
  [0.24, 0],
  [0.34, 0],
  [-0.1, 0],
  [0.16, 0.14],
  [0.16, -0.14],
  [0.26, 0.1],
  [0.26, -0.1],
  [0, 0.16],
  [0, -0.14],
];

export const RADAR_PROFILE_OFFSETS_SAMUI: [number, number][] = [
  [0, 0],
  [0.09, 0],
  [-0.07, 0],
  [0, 0.09],
  [0, -0.09],
  [0.1, 0.07],
  [0.1, -0.07],
];

/** Fewer decode passes per scan — hourly timeline hammers ImageBitmap; keep overlap with full ring. */
export const RADAR_PROFILE_OFFSETS_TIMELINE_KRABI: [number, number][] = [
  [0, 0],
  [0.28, 0],
  [0.14, 0.12],
  [0, 0.16],
];

export const RADAR_PROFILE_OFFSETS_TIMELINE_SAMUI: [number, number][] = [
  [0, 0],
  [0.08, 0],
  [0, 0.08],
];
