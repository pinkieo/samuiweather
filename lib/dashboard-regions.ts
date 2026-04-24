import { SAMUI_CENTER } from './spire';

export type DashboardRegionId = 'samui' | 'krabi_baan_mook_taley';

/** WGS84 pins on the explore map (villa + optional Ecowitt / station). */
export interface HomeMapPin {
  lat: number;
  lon: number;
  label: string;
  area?: string;
  /** Small heading above the name, e.g. Ecowitt “Local Precision”. */
  badge?: string;
}

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
  /**
   * `weather_forecast` / `sammi_*` `location_id` in Supabase (server-side API). `null` = no Sammi DB link.
   */
  weatherLocationId: string | null;
  /**
   * Home / station pin(s) at true WGS84 (map `initial*` still uses lat/lon + offsets).
   * Samui: Villa Mayula + Baan Ton Kluay (Ecowitt); Krabi: single Baan Mook Taley.
   */
  homePins?: HomeMapPin[];
}

/**
 * Airbnb listing for the measurement / villa point (short link may require login to open).
 * @see https://abnb.me/K6ysWW5z4U
 */
export const BAAN_MOOK_TALEY_AIRBNB_URL =
  'https://abnb.me/K6ysWW5z4U' as const;

/**
 * Baan Mook Taley — Long Beach, Ao Nang, Krabi (national park coast); pin + Spire/tides.
 */
export const BAAN_MOOK_TALEY_WGS84 = {
  lat: 8.04561,
  lon: 98.78503,
} as const;

/**
 * Villa Mayula — WGS84 (8/205 Plai Laem Soi 7, Bo Phut, Ko Samui 84320).
 * Google Maps centre: 9.589479, 100.065801.
 */
export const VILLA_MAYULA_WGS84 = {
  lat: 9.589479,
  lon: 100.065801,
} as const;

/**
 * Baan Ton Kluay — Ecowitt station; WGS84 from Google Maps dropped pin.
 * Address: 130 Thanon Bo Phut, Tambon Bo Phut, Ko Samui 84320.
 */
export const BAAN_TON_KLUAY_WGS84 = {
  lat: 9.548641,
  lon: 100.032242,
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
    /** Default: see `WEATHER_LOCATION_ID` / engine ingest for `weather_forecast`. */
    weatherLocationId: 'samui_opf_hybrid',
    homePins: [
      {
        lat: VILLA_MAYULA_WGS84.lat,
        lon: VILLA_MAYULA_WGS84.lon,
        label: 'Villa Mayula',
        area: 'Plai Laem Soi 7 · Bo Phut',
      },
      {
        lat: BAAN_TON_KLUAY_WGS84.lat,
        lon: BAAN_TON_KLUAY_WGS84.lon,
        badge: 'Local Precision',
        label: 'Baan Ton Kluay',
        area: 'Koh Samui',
      },
    ],
  },
  krabi_baan_mook_taley: {
    id: 'krabi_baan_mook_taley',
    shortLabel: 'Krabi',
    title: 'Krabi · Baan Mook Taley · Live radar',
    subtitle: 'Long Beach Ao Nang · 166 Moo 4 Soi Khlong Saikhao 3',
    lat: BAAN_MOOK_TALEY_WGS84.lat,
    lon: BAAN_MOOK_TALEY_WGS84.lon,
    mapZoom: 9,
    /** Center on property / beach (no drawer nudge — zoom shows the shore). */
    lngOffset: 0,
    latOffset: 0,
    isSamuiProduct: false,
    /** No `sammi_*` row for Krabi until a separate `location_id` exists in the DB. */
    weatherLocationId: null,
    homePins: [
      {
        lat: BAAN_MOOK_TALEY_WGS84.lat,
        lon: BAAN_MOOK_TALEY_WGS84.lon,
        label: 'Baan Mook Taley',
      },
    ],
  },
};

/** Primary QA tab while Krabi rain + map UX are validated; switch to `samui` when parity is ready. */
export const DEFAULT_DASHBOARD_REGION_ID: DashboardRegionId = 'krabi_baan_mook_taley';

/** Tab order in the UI — Krabi first during rain-data focus. */
export const DASHBOARD_REGION_TAB_ORDER: DashboardRegionId[] = [
  'krabi_baan_mook_taley',
  'samui',
];

export function getDashboardRegion(id: DashboardRegionId): DashboardRegion {
  return DASHBOARD_REGIONS[id];
}

/**
 * “Now · this hour” — short lines for the drawer; no model jargon. {@link getHolidayNowBasePanel}
 * picks Samui (local tuning / `weatherLocationId` or `isSamuiProduct`) vs other spots (e.g. Krabi)
 * the same way as the old blend copy.
 *
 * **Extending later:** new islands (Phuket, Koh Lanta, …) = new `DashboardRegionId` + entry in
 * `DASHBOARD_REGIONS`; optional `weatherLocationId` drives which of the two phrasings is used.
 * Extra “shower / thunder” lines are computed in `getHolidayNowAmenityHints` (`lib/holiday-now-hints.ts`).
 */
export type HolidayNowPanel = {
  title: string;
  lines: readonly [string, string];
};

/**
 * True when the product has a Supabase/OPF path for that place (Samui today) — warmer “dry and warm”
 * line. Krabi: no `weatherLocationId` yet → “models show dry conditions” line.
 */
function regionUsesOpfStyleBlend(r: DashboardRegion): boolean {
  return Boolean(r.weatherLocationId) || r.isSamuiProduct;
}

export function getHolidayNowBasePanel(region: DashboardRegion): HolidayNowPanel {
  if (regionUsesOpfStyleBlend(region)) {
    return {
      title: 'Now · this hour',
      lines: [
        "Right now it's dry and warm.",
        'The time bar below shows the forecast for the coming hours.',
      ],
    };
  }
  return {
    title: 'Now · this hour',
    lines: [
      'Right now: latest weather models show dry conditions.',
      'The time bar below shows the forecast for the coming hours.',
    ],
  };
}
