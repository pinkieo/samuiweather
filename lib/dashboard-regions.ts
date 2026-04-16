import { SAMUI_CENTER } from './spire';

export type DashboardRegionId = 'samui' | 'krabi_baan_mook_taley';

export interface DashboardRegion {
  id: DashboardRegionId;
  /** Tab label */
  shortLabel: string;
  /** Drawer title */
  title: string;
  /** Subtitle under radar (testing note for Krabi) */
  subtitle?: string;
  lat: number;
  lon: number;
  /** Initial map zoom */
  mapZoom: number;
  /** Shift initial center so the weather drawer does not cover the focal area */
  lngOffset: number;
  latOffset: number;
  /** Show Koh Samui POI markers + Sammi airport intel */
  isSamuiProduct: boolean;
}

/**
 * Airbnb listing for the measurement / villa point (short link may require login to open).
 * @see https://abnb.me/K6ysWW5z4U
 */
export const BAAN_MOOK_TALEY_AIRBNB_URL =
  'https://abnb.me/K6ysWW5z4U' as const;

/**
 * WGS84 for Spire/tides/AQ/UV on the Krabi tab.
 * Uses OpenStreetMap centroid for **Klong Muang beach** (หาดคลองม่วง), i.e. the same
 * beach strip as Baan Mook Taley (166 Moo 4, Soi Klong Sai Keaw 3, Ban Nateen). For
 * sub‑100 m precision, replace with a pin from Google Maps at the pool/deck.
 */
const KRABI_BAAN_MOOK_TALEY = {
  lat: 8.0496559,
  lon: 98.7574128,
} as const;

export const DASHBOARD_REGIONS: Record<DashboardRegionId, DashboardRegion> = {
  samui: {
    id: 'samui',
    shortLabel: 'Samui',
    title: 'Samui Weather · Live radar',
    lat: SAMUI_CENTER.lat,
    lon: SAMUI_CENTER.lon,
    mapZoom: 11,
    lngOffset: -0.034,
    latOffset: -0.02,
    isSamuiProduct: true,
  },
  krabi_baan_mook_taley: {
    id: 'krabi_baan_mook_taley',
    shortLabel: 'Krabi',
    title: 'Krabi · Baan Mook Taley · Live radar',
    subtitle: 'Baan Mook Taley · Klong Muang (listing: abnb.me/K6ysWW5z4U)',
    lat: KRABI_BAAN_MOOK_TALEY.lat,
    lon: KRABI_BAAN_MOOK_TALEY.lon,
    mapZoom: 11,
    lngOffset: -0.022,
    latOffset: -0.014,
    isSamuiProduct: false,
  },
};

export const DEFAULT_DASHBOARD_REGION_ID: DashboardRegionId = 'samui';

/** Tab order in the UI */
export const DASHBOARD_REGION_TAB_ORDER: DashboardRegionId[] = [
  'samui',
  'krabi_baan_mook_taley',
];

export function getDashboardRegion(id: DashboardRegionId): DashboardRegion {
  return DASHBOARD_REGIONS[id];
}
