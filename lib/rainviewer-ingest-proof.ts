/**
 * Audit trail for what RainViewer supplies vs what our app downloads.
 *
 * - **Weather Maps API** (`/public/weather-maps.json`): each `radar.past[].path` is a **single nationwide
 *   composite** reflectivity product (RainViewer: “composite radar reflectivity”), not a per-station path.
 * - Thailand station **table IDs** (e.g. Phuket **PHU**, Surat Thani **SRT**, Sathing Phra **SKA**) appear on
 *   RainViewer’s site; they are **not** repeated inside each composite `path` string — so the app cannot read
 *   station IDs out of the frame id; inclusion is by RainViewer’s mosaic pipeline.
 *
 * @see https://www.rainviewer.com/api/weather-maps-api.html — composite tiles
 * @see https://www.rainviewer.com/radars/thailand.html — ID ↔ location table (PHU, SRT, SKA, …)
 */

export const RAINVIEWER_WEATHER_MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json';

export const RAINVIEWER_THAILAND_RADAR_INDEX_URL =
  'https://www.rainviewer.com/radars/thailand.html';

/** RainViewer’s public table IDs (not TMD WMO numbers). */
export const RAINVIEWER_IDS = {
  phuket: 'PHU',
  /** Mainland Doppler near Samui — RainViewer Thailand table “Surat Thani”. */
  suratThani: 'SRT',
  sathingPhra: 'SKA',
} as const;

export type RainViewerIngestProof = {
  weatherMapsApi: string;
  thailandRadarIndex: string;
  /** Composite: one path per scan time — not station-specific. */
  compositeTileSemantics: string;
  /** Stations the user asked about — IDs on RainViewer’s Thailand list. */
  stationsOnRainViewerIndex: ReadonlyArray<{
    rainViewerId: string;
    locationName: string;
  }>;
  /** What to tell auditors: we ingest composite paths only; PHU/SRT/SKA are inputs to RainViewer’s merge, not JSON fields. */
  howThisRelatesToCompositeDownload: string;
};

export function getRainViewerIngestProof(): RainViewerIngestProof {
  return {
    weatherMapsApi: RAINVIEWER_WEATHER_MAPS_URL,
    thailandRadarIndex: RAINVIEWER_THAILAND_RADAR_INDEX_URL,
    compositeTileSemantics:
      'Each radar.past[].path (e.g. /v2/radar/abc…) addresses one merged mosaic for that timestamp — station codes PHU/SRT/SKA do not appear inside the path.',
    stationsOnRainViewerIndex: [
      { rainViewerId: RAINVIEWER_IDS.phuket, locationName: 'Phuket' },
      { rainViewerId: RAINVIEWER_IDS.suratThani, locationName: 'Surat Thani' },
      { rainViewerId: RAINVIEWER_IDS.sathingPhra, locationName: 'Sathing Phra' },
    ],
    howThisRelatesToCompositeDownload:
      'The software fetches only weather-maps.json + tilecache URLs under that path. RainViewer documents the Thailand network (including PHU, SRT, SKA) as contributing radars; the delivered tiles are the composite that incorporates those sources.',
  };
}
