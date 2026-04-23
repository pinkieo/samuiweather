import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getKrabiForecastMerged,
  getSamuiForecastMerged,
  KRABI_FORECAST_POINT,
  SAMUI_CENTER,
} from '@/lib/spire';
import {
  fetchLatestRainViewerFramePath,
  mergeLandRadarVerdict,
  sampleRainViewerPrecipNearPin,
} from '@/lib/rainviewer-server-sample';
import {
  getRadarStatus,
  type AirportSnapshot,
  airportSnapshotFromIcao,
} from '@/lib/sammi-post-generator';
import {
  resolveWeatherConflict,
  type ConflictResult,
  type MeteoblueCheck,
  type ResolveWeatherConflictOptions,
} from '@/lib/weather-conflict';
import {
  TH_SOUTH_METAR_URL,
  type RawMetar,
} from '@/lib/metar';

/** Safety strip must not be ISR-cached — stale `all_clear` during an approaching cell is unacceptable. */
export const dynamic = 'force-dynamic';

export interface ConflictStatusResponse {
  scenario:     ConflictResult['scenario'];
  confidence:   ConflictResult['confidence'];
  finalVerdict: string;
  statusBoard:  ConflictResult['statusBoard'];
  isAlert:      boolean;
  fetchedAt:    number;
  error?:       string;
}

async function buildAirportSnapshot(): Promise<AirportSnapshot | null> {
  try {
    const res = await fetch(TH_SOUTH_METAR_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const raw: RawMetar[] = await res.json();
    return airportSnapshotFromIcao(raw, 'VTSM');
  } catch {
    return null;
  }
}

async function buildKrabiDualSnapshots(): Promise<{
  krabi: AirportSnapshot | null;
  phuket: AirportSnapshot | null;
}> {
  try {
    const res = await fetch(TH_SOUTH_METAR_URL, { cache: 'no-store' });
    if (!res.ok) return { krabi: null, phuket: null };
    const raw: RawMetar[] = await res.json();
    return {
      krabi:  airportSnapshotFromIcao(raw, 'VTSG'),
      phuket: airportSnapshotFromIcao(raw, 'VTSP'),
    };
  } catch {
    return { krabi: null, phuket: null };
  }
}

async function fetchMeteoblueCheck(at?: { lat: number; lon: number }): Promise<MeteoblueCheck | null> {
  try {
    const apiKey = process.env.METEOBLUE_API_KEY;
    if (!apiKey) return null;
    const lat = at != null ? String(at.lat) : (process.env.METEOBLUE_LAT ?? '9.5120');
    const lon = at != null ? String(at.lon) : (process.env.METEOBLUE_LON ?? '100.0137');
    const asl = process.env.METEOBLUE_ASL ?? '5';
    const url = `https://my.meteoblue.com/packages/basic-1h?apikey=${apiKey}&lat=${lat}&lon=${lon}&asl=${asl}&format=json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await res.json();
    const d = raw.data_1h;
    return {
      precipMm:   d.precipitation?.[0]             ?? 0,
      precipProb: d.precipitation_probability?.[0] ?? 0,
      cloudCover: d.lowclouds?.[0]                 ?? 0,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const region = req.nextUrl.searchParams.get('region') === 'krabi' ? 'krabi' : 'samui';

  const ac = new AbortController();
  const abortT = setTimeout(() => ac.abort(), 28_000);

  try {
    const [forecastRows, meteoblue, airportData, framePath] = await Promise.all([
      region === 'krabi'
        ? getKrabiForecastMerged(ac.signal)
        : getSamuiForecastMerged(ac.signal),
      fetchMeteoblueCheck(region === 'krabi' ? KRABI_FORECAST_POINT : undefined),
      region === 'krabi' ? buildKrabiDualSnapshots() : buildAirportSnapshot(),
      fetchLatestRainViewerFramePath(ac.signal),
    ]);

    const noStore = { 'Cache-Control': 'private, no-store, max-age=0, must-revalidate' };

    if (!forecastRows.length) {
      return NextResponse.json(
        { error: 'No forecast data', isAlert: false, fetchedAt: Math.floor(Date.now() / 1000) },
        { status: 502, headers: noStore },
      );
    }

    const now = forecastRows[0];
    const pin = region === 'krabi' ? KRABI_FORECAST_POINT : SAMUI_CENTER;
    let tileSample: 'none' | 'precip' | 'unknown' = 'unknown';
    if (framePath) {
      tileSample = await sampleRainViewerPrecipNearPin(
        pin.lat,
        pin.lon,
        framePath,
        ac.signal,
        region === 'krabi' ? 'krabi' : 'samui',
      );
    }
    const radar = mergeLandRadarVerdict(getRadarStatus(now.precipRate), tileSample);

    let conflictOpts: ResolveWeatherConflictOptions | undefined;
    let airport: AirportSnapshot | null;

    if (region === 'krabi') {
      const dual = airportData as { krabi: AirportSnapshot | null; phuket: AirportSnapshot | null };
      airport = dual.krabi;
      conflictOpts = { krabiDualAirport: { krabi: dual.krabi, phuket: dual.phuket } };
    } else {
      airport = airportData as AirportSnapshot | null;
    }

    const conflict = resolveWeatherConflict(
      {
        precipRate:  now.precipRate,
        pop:         now.pop,
        cloudCover:  now.cloudCover,
        temp:        now.temp,
        windSpeed:   now.windSpeed,
      },
      radar,
      airport,
      meteoblue,
      conflictOpts,
    );

    const isAlert =
      conflict.scenario === 'storm_incoming' ||
      conflict.scenario === 'all_alarm' ||
      conflict.scenario === 'rain_alert' ||
      (region === 'krabi' && conflict.scenario === 'upstream_metar_rain');

    return NextResponse.json(
      {
        scenario:     conflict.scenario,
        confidence:   conflict.confidence,
        finalVerdict: conflict.finalVerdict,
        statusBoard:  conflict.statusBoard,
        isAlert,
        fetchedAt:    Math.floor(Date.now() / 1000),
      } satisfies ConflictStatusResponse,
      { headers: noStore },
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('conflict-status:', message);
    return NextResponse.json(
      { error: message, isAlert: false, fetchedAt: Math.floor(Date.now() / 1000) },
      { status: 500, headers: { 'Cache-Control': 'private, no-store, max-age=0, must-revalidate' } },
    );
  } finally {
    clearTimeout(abortT);
  }
}
