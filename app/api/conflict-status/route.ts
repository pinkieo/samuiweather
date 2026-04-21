import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getKrabiForecastMerged, getSamuiForecastMerged, KRABI_FORECAST_POINT } from '@/lib/spire';
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

export const revalidate = 300;

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
    const res = await fetch(TH_SOUTH_METAR_URL, { next: { revalidate: 300 } });
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
    const res = await fetch(TH_SOUTH_METAR_URL, { next: { revalidate: 300 } });
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
    const res = await fetch(url, { next: { revalidate: 3600 } });
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

  try {
    const [forecastRows, meteoblue, airportData] = await Promise.all([
      region === 'krabi'
        ? getKrabiForecastMerged(new AbortController().signal)
        : getSamuiForecastMerged(new AbortController().signal),
      fetchMeteoblueCheck(region === 'krabi' ? KRABI_FORECAST_POINT : undefined),
      region === 'krabi' ? buildKrabiDualSnapshots() : buildAirportSnapshot(),
    ]);

    if (!forecastRows.length) {
      return NextResponse.json(
        { error: 'No forecast data', isAlert: false, fetchedAt: Math.floor(Date.now() / 1000) },
        { status: 502 },
      );
    }

    const now   = forecastRows[0];
    const radar = getRadarStatus(now.precipRate);

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
      (region === 'krabi' &&
        (conflict.scenario === 'upstream_metar_rain' || conflict.scenario === 'rain_alert'));

    return NextResponse.json({
      scenario:     conflict.scenario,
      confidence:   conflict.confidence,
      finalVerdict: conflict.finalVerdict,
      statusBoard:  conflict.statusBoard,
      isAlert,
      fetchedAt:    Math.floor(Date.now() / 1000),
    } satisfies ConflictStatusResponse);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('conflict-status:', message);
    return NextResponse.json(
      { error: message, isAlert: false, fetchedAt: Math.floor(Date.now() / 1000) },
      { status: 500 },
    );
  }
}
