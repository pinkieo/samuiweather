import { NextResponse } from 'next/server';
import {
  TH_SOUTH_AIRPORT_ICAOS,
  TH_SOUTH_AIRPORT_VOICE,
  TH_SOUTH_METAR_URL,
  TH_SOUTH_TAF_URL,
  parseMetar,
  parseTaf,
  pickRawMetarForIcao,
  pickRawTafForIcao,
  type ParsedMetar,
  type ParsedTaf,
  type RawMetar,
  type RawTaf,
  type ThSouthAirportIcao,
} from '@/lib/metar';
import { metarFreshness, type SourceFreshness } from '@/lib/data-freshness';

export const revalidate = 300;

export type MetarStationKey = ThSouthAirportIcao;

export interface StationMetarBundle {
  metar: ParsedMetar | null;
  taf: ParsedTaf | null;
  freshness: SourceFreshness | null;
}

export interface MetarApiResponse {
  stations: Record<MetarStationKey, StationMetarBundle>;
  fetchedAt: number;
  error?: string;
}

function emptyBundle(): StationMetarBundle {
  return { metar: null, taf: null, freshness: null };
}

export async function GET() {
  try {
    const [metarRes, tafRes] = await Promise.allSettled([
      fetch(TH_SOUTH_METAR_URL, { next: { revalidate: 300 } }),
      fetch(TH_SOUTH_TAF_URL, { next: { revalidate: 300 } }),
    ]);

    const stations = Object.fromEntries(
      TH_SOUTH_AIRPORT_ICAOS.map(k => [k, emptyBundle()]),
    ) as Record<MetarStationKey, StationMetarBundle>;

    let metarRows: RawMetar[] = [];
    if (metarRes.status === 'fulfilled' && metarRes.value.ok) {
      metarRows = await metarRes.value.json();
    }

    let tafRows: RawTaf[] = [];
    if (tafRes.status === 'fulfilled' && tafRes.value.ok) {
      tafRows = await tafRes.value.json();
    }

    for (const icao of TH_SOUTH_AIRPORT_ICAOS) {
      const voice = TH_SOUTH_AIRPORT_VOICE[icao];
      const rawM = pickRawMetarForIcao(metarRows, icao);
      if (rawM) {
        const metar = parseMetar(rawM, { airportLabel: voice });
        stations[icao] = {
          ...stations[icao],
          metar,
          freshness: metarFreshness(metar.obsTime),
        };
      }
      const rawT = pickRawTafForIcao(tafRows, icao);
      if (rawT) {
        stations[icao].taf = parseTaf(rawT, { airportLabel: voice });
      }
    }

    return NextResponse.json({
      stations,
      fetchedAt: Math.floor(Date.now() / 1000),
    } satisfies MetarApiResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const empty = Object.fromEntries(
      TH_SOUTH_AIRPORT_ICAOS.map(k => [k, emptyBundle()]),
    ) as Record<MetarStationKey, StationMetarBundle>;
    return NextResponse.json(
      {
        stations: empty,
        fetchedAt: Math.floor(Date.now() / 1000),
        error: message,
      } satisfies MetarApiResponse,
      { status: 500 },
    );
  }
}
