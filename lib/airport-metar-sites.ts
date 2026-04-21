/**
 * ICAO airport METAR sites shown on the explore map (✈️) — distinct from TMD Doppler mosaic pins (📡).
 * Coordinates WGS84 · public aerodrome reference points.
 */

export type AirportMetarSite = {
  id: string;
  icao: string;
  iata: string;
  label: string;
  /** Degrees WGS84 */
  lat: number;
  lon: number;
};

/** Southern Thailand — Samui, Krabi, Phuket international airports (METAR / TAF sources). */
export const AIRPORT_METAR_SITES_TH_SOUTH: readonly AirportMetarSite[] = [
  {
    id: 'vtsm',
    icao: 'VTSM',
    iata: 'USM',
    label: 'Samui Int’l',
    lat: 9.547_778,
    lon: 100.062_778,
  },
  {
    id: 'vtsg',
    icao: 'VTSG',
    iata: 'KBV',
    label: 'Krabi Int’l',
    lat: 8.095_556,
    lon: 98.986_389,
  },
  {
    id: 'vtsp',
    icao: 'VTSP',
    iata: 'HKT',
    label: 'Phuket Int’l',
    lat: 8.113_056,
    lon: 98.316_944,
  },
] as const;
