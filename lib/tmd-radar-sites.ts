/**
 * TMD Doppler sites referenced on the map (WMO / Thai Meteorological Department).
 * RainViewer serves a nationwide composite; these are major southern contributors for Andaman coverage.
 * @see Typhoon Committee member report — Thailand radar network (WMO refs e.g. 48565 Phuket, 48568 Sathing Phra).
 */

import { RAINVIEWER_IDS } from './rainviewer-ingest-proof';

export type TmdRadarSite = {
  id: string;
  wmo: number;
  code: string;
  /** RainViewer Thailand radar table ID (not present in composite `path` strings). */
  rainViewerId: string;
  label: string;
  /** Degrees WGS84 */
  lat: number;
  lon: number;
};

/** Phuket Airport · PKT — Andaman west (Krabi / Phuket arcs). */
const PKT: TmdRadarSite = {
  id: 'pkt',
  wmo: 48565,
  code: 'PKT',
  rainViewerId: RAINVIEWER_IDS.phuket,
  label: 'Phuket (TMD)',
  lat: 8 + 8 / 60 + 1 / 3600,
  lon: 98 + 19 / 60 + 46 / 3600,
};

/** Surat Thani · SRT — Gulf mainland; primary arc for Koh Samui (RainViewer table ID SRT). */
const SURAT_THANI: TmdRadarSite = {
  id: 'srt',
  /** Regional WMO index (synoptic); radar site ~Phunphin / province. */
  wmo: 48532,
  code: 'SRT',
  rainViewerId: RAINVIEWER_IDS.suratThani,
  label: 'Surat Thani (TMD)',
  lat: 9 + 8 / 60 + 13 / 3600,
  lon: 99 + 18 / 60 + 22 / 3600,
};

/** Sathing Phra · STP — Songkhla province / Malacca side (southern peninsula). */
const STP: TmdRadarSite = {
  id: 'stp',
  wmo: 48568,
  code: 'STP',
  rainViewerId: RAINVIEWER_IDS.sathingPhra,
  label: 'Sathing Phra (TMD)',
  lat: 7 + 26 / 60 + 59.98 / 3600,
  lon: 100 + 27 / 60 + 35.98 / 3600,
};

/** Southern / Andaman-focused radars shown on the dashboard map legend (west → east). */
export const TMD_RADAR_MARKERS_SOUTH: readonly TmdRadarSite[] = [PKT, SURAT_THANI, STP] as const;
