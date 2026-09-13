import { NextRequest, NextResponse } from 'next/server';
import {
  ECOWITT_LOCATION_ID,
  fetchEcowittDaily,
  parseIctDateYmd,
  yesterdayIctDate,
} from '@/lib/ecowitt-data';
import {
  SPIRE_LOCATION_ID,
  bucketStationHours,
  fetchSpireHoursForIctDay,
  scoreForecastDay,
} from '@/lib/forecast-day-accuracy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Spire vs Baan Ton Kluay for one ICT day. Default date = yesterday. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = parseIctDateYmd(url.searchParams.get('date')) ?? yesterdayIctDate();
  const stationId = url.searchParams.get('location')?.trim() || ECOWITT_LOCATION_ID;
  const forecastLocationId =
    url.searchParams.get('forecastLocation')?.trim() || SPIRE_LOCATION_ID;

  const [station, forecast] = await Promise.all([
    fetchEcowittDaily(date, stationId),
    fetchSpireHoursForIctDay(date, forecastLocationId),
  ]);
  if (!station.ok) {
    return NextResponse.json({ error: station.error, date }, { status: 500 });
  }
  if (!forecast.ok) {
    return NextResponse.json({ error: forecast.error, date }, { status: 500 });
  }

  const hours = bucketStationHours(station.samples);
  const score = station.summary.available
    ? scoreForecastDay(station.summary, hours, forecast.hours)
    : null;

  return NextResponse.json(
    {
      date,
      timezone: 'Asia/Bangkok',
      available: station.summary.available && forecast.hours.length > 0,
      station: station.summary,
      forecast: {
        locationId: forecastLocationId,
        hours: forecast.hours.length,
        temperatureMinC: minOf(forecast.hours.map((h) => h.tempC)),
        temperatureMaxC: maxOf(forecast.hours.map((h) => h.tempC)),
      },
      score,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

function minOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? Math.min(...nums) : null;
}

function maxOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? Math.max(...nums) : null;
}
