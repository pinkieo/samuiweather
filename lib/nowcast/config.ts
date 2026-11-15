/**
 * Samui rain-cell nowcast (EXPERIMENTAL) — shared constants.
 * Faithful TypeScript port of the offline Python prototype (samui-nowcast, snw/config.py).
 */

/** Target point: Bo Phut / Villa Mayula (lat, lon). */
export const BOPHUT = { lat: 9.56, lon: 100.03 } as const;

/** Wider analysis domain (~±1° / ~110 km) so cells outside the island box that head in are tracked. */
export const CONTEXT = { latS: 8.56, latN: 10.56, lonW: 99.03, lonE: 101.03 } as const;

export const RAINVIEWER_HOST = 'https://tilecache.rainviewer.com';
export const RAINVIEWER_CATALOG_URL = 'https://api.rainviewer.com/public/weather-maps.json';
export const USER_AGENT = 'SamuiWeatherDashboard/1.0 (Koh Samui local weather app; experimental nowcast)';

/** RainViewer public tiles stop at zoom 7; one z7 tile (99/60) covers the whole context domain. */
export const Z = 7;
export const TILE = 256;
export const TILE_X = 99;
export const TILE_Y = 60;
/** Raw pixels (no smoothing / snow colours) so the palette decodes exactly. */
export const TILE_OPTS = '0_0';
/** Universal Blue — the only colour scheme the public API still serves. */
export const COLOR_SCHEME = 2;

/** Bangkok / Samui is UTC+7 (no DST); used for display only. */
export const ICT_OFFSET_S = 7 * 3600;

export const CELL_DBZ = 20.0;
export const MIN_AREA_PX = 5;
/** Newest published frame older than this => STALE. */
export const STALE_MIN = 20;
/** Alert radius: rain edge within this distance of Bo Phut. */
export const REACH_KM = 10.0;
/** "Rain at Bo Phut": nearest rain pixel within ~3 km. */
export const POINT_KM = 3.0;
export const HORIZON_MIN = 180;
export const LEAD_STEP_MIN = 5;
export const NEAR_KM = 70.0;
export const MAX_SPEED_KMH = 90.0;

/** Metres-per-pixel at Bo Phut latitude, in km. */
export function kmPerPx(lat: number = BOPHUT.lat): number {
  return (40075.017 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** Z);
}
