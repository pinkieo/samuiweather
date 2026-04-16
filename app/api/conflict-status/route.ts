import { NextResponse } from 'next/server';
import { getSamuiForecastMerged } from '@/lib/spire';
import { getRadarStatus, type AirportSnapshot } from '@/lib/sammi-post-generator';
import { resolveWeatherConflict, type ConflictResult, type MeteoblueCheck } from '@/lib/weather-conflict';
import { parseMetar, VTSM_METAR_URL, type RawMetar } from '@/lib/metar';

export const revalidate = 300;

export interface ConflictStatusResponse {
  scenario:     ConflictResult['scenario'];
  confidence:   ConflictResult['confidence'];
  finalVerdict: string;
  statusBoard:  ConflictResult['statusBoard'];
  isAlert:      boolean;   // true when scenario is storm_incoming or all_alarm
  fetchedAt:    number;
  error?:       string;
}

async function buildAirportSnapshot(): Promise<AirportSnapshot | null> {
  try {
    const res = await fetch(VTSM_METAR_URL, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const raw: RawMetar[] = await res.json();
    if (!raw.length) return null;
    const m = parseMetar(raw[0]);
    const baseFt = m.clouds[0]?.base ?? null;
    return {
      raw:            m.raw,
      tempC:          m.temp,
      windKts:        m.wspd,
      windDir:        m.wdir,
      gustKts:        m.wgst,
      visib:          m.visib,
      cloudCoverCode: m.clouds[0]?.cover ?? null,
      cloudBaseFt:    baseFt,
      cloudBaseM:     baseFt ? Math.round(baseFt * 0.3048 / 50) * 50 : null,
      fltCat:         m.fltCat,
      wxString:       m.wxString,
    };
  } catch {
    return null;
  }
}

async function fetchMeteoblueCheck(): Promise<MeteoblueCheck | null> {
  try {
    const apiKey = process.env.METEOBLUE_API_KEY;
    if (!apiKey) return null;
    const lat = process.env.METEOBLUE_LAT ?? '9.5120';
    const lon = process.env.METEOBLUE_LON ?? '100.0137';
    const asl = process.env.METEOBLUE_ASL ?? '5';
    const url = `https://my.meteoblue.com/packages/basic-1h?apikey=${apiKey}&lat=${lat}&lon=${lon}&asl=${asl}&format=json`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await res.json();
    const d = raw.data_1h;
    // Use the closest current hour (index 0)
    return {
      precipMm:   d.precipitation?.[0]             ?? 0,
      precipProb: d.precipitation_probability?.[0] ?? 0,
      cloudCover: d.lowclouds?.[0]                 ?? 0,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const [forecastRows, airport, meteoblue] = await Promise.all([
      getSamuiForecastMerged(new AbortController().signal),
      buildAirportSnapshot(),
      fetchMeteoblueCheck(),
    ]);

    if (!forecastRows.length) {
      return NextResponse.json(
        { error: 'No forecast data', isAlert: false, fetchedAt: Math.floor(Date.now() / 1000) },
        { status: 502 },
      );
    }

    const now   = forecastRows[0];
    const radar = getRadarStatus(now.precipRate);

    const conflict = resolveWeatherConflict({
      precipRate:  now.precipRate,
      pop:         now.pop,
      cloudCover:  now.cloudCover,
      temp:        now.temp,
      windSpeed:   now.windSpeed,
    }, radar, airport, meteoblue);

    const isAlert = conflict.scenario === 'storm_incoming' || conflict.scenario === 'all_alarm';

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
