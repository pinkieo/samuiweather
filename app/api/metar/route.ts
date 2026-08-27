import { NextResponse } from 'next/server';
import {
  AVIATIONWEATHER_USER_AGENT,
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
import {
  CACHE_CONTROL_NO_STORE,
  buildProvenance,
  isoFromUnixSeconds,
  type WeatherProvenance,
} from '@/lib/weather-provenance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export type MetarStationKey = ThSouthAirportIcao;

export interface StationMetarBundle {
  metar: ParsedMetar | null;
  taf: ParsedTaf | null;
  freshness: SourceFreshness | null;
  provenance: WeatherProvenance | null;
}

export interface MetarApiResponse {
  stations: Record<MetarStationKey, StationMetarBundle>;
  fetchedAt: number;
  fetched_at: string;
  error?: string;
}

const noStore = { 'Cache-Control': CACHE_CONTROL_NO_STORE };

function emptyBundle(): StationMetarBundle {
  return { metar: null, taf: null, freshness: null, provenance: null };
}

async function fetchAviationJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'User-Agent': AVIATIONWEATHER_USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(`aviationweather.gov HTTP ${res.status}`);
  }
  return res.json();
}

export async function GET() {
  const fetchedAt = Math.floor(Date.now() / 1000);
  const fetchedIso = isoFromUnixSeconds(fetchedAt);
  try {
    const [metarRes, tafRes] = await Promise.allSettled([
      fetchAviationJson(TH_SOUTH_METAR_URL),
      fetchAviationJson(TH_SOUTH_TAF_URL),
    ]);

    const stations = Object.fromEntries(
      TH_SOUTH_AIRPORT_ICAOS.map(k => [k, emptyBundle()]),
    ) as Record<MetarStationKey, StationMetarBundle>;

    let metarRows: RawMetar[] = [];
    if (metarRes.status === 'fulfilled' && Array.isArray(metarRes.value)) {
      metarRows = metarRes.value as RawMetar[];
    }

    let tafRows: RawTaf[] = [];
    if (tafRes.status === 'fulfilled' && Array.isArray(tafRes.value)) {
      tafRows = tafRes.value as RawTaf[];
    }

    const fetchErrors: string[] = [];
    if (metarRes.status === 'rejected') {
      fetchErrors.push(`METAR: ${metarRes.reason instanceof Error ? metarRes.reason.message : String(metarRes.reason)}`);
    }
    if (tafRes.status === 'rejected') {
      fetchErrors.push(`TAF: ${tafRes.reason instanceof Error ? tafRes.reason.message : String(tafRes.reason)}`);
    }

    for (const icao of TH_SOUTH_AIRPORT_ICAOS) {
      const voice = TH_SOUTH_AIRPORT_VOICE[icao];
      const rawM = pickRawMetarForIcao(metarRows, icao);
      if (rawM) {
        const metar = parseMetar(rawM, { airportLabel: voice });
        const freshness = metarFreshness(metar.obsTime, fetchedAt);
        const provenance = buildProvenance({
          source: 'metar',
          staleAfterMinutes: 45,
          observedAtIso: isoFromUnixSeconds(metar.obsTime),
          fetchedAtIso: fetchedIso,
          nowUnix: fetchedAt,
          place: voice,
        });
        stations[icao] = {
          ...stations[icao],
          metar,
          freshness,
          provenance,
        };
      }
      const rawT = pickRawTafForIcao(tafRows, icao);
      if (rawT) {
        stations[icao].taf = parseTaf(rawT, { airportLabel: voice });
      }
    }

    const body: MetarApiResponse = {
      stations,
      fetchedAt,
      fetched_at: fetchedIso,
    };
    if (fetchErrors.length > 0) {
      body.error = fetchErrors.join('; ');
    }

    const vtsmStale = stations.VTSM.provenance?.stale === true;
    return NextResponse.json(body, {
      status: fetchErrors.length > 0 && !stations.VTSM.metar ? 502 : 200,
      headers: {
        ...noStore,
        'X-Weather-Source': 'metar',
        'X-Fetched-At': fetchedIso,
        'X-Weather-Stale': vtsmStale ? '1' : '0',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const empty = Object.fromEntries(
      TH_SOUTH_AIRPORT_ICAOS.map(k => [k, emptyBundle()]),
    ) as Record<MetarStationKey, StationMetarBundle>;
    return NextResponse.json(
      {
        stations: empty,
        fetchedAt,
        fetched_at: fetchedIso,
        error: message,
      } satisfies MetarApiResponse,
      { status: 500, headers: noStore },
    );
  }
}
