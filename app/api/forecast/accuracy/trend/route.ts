import { NextRequest, NextResponse } from 'next/server';
import { parseIctDateYmd, yesterdayIctDate } from '@/lib/ecowitt-data';
import { scoreForecastTrend } from '@/lib/forecast-accuracy-trend';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

const CACHE_MS = 20 * 60 * 1000;
type CacheEntry = { at: number; body: unknown };
const cache = new Map<string, CacheEntry>();

function addIctDays(ymd: string, delta: number): string {
  const noon = new Date(`${ymd}T12:00:00+07:00`);
  return new Date(noon.getTime() + delta * 86400000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** Spire vs Ecowitt for every ICT day in [from, to]. Defaults: last 60 days through yesterday. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const yesterday = yesterdayIctDate();
  const to = parseIctDateYmd(url.searchParams.get('to')) ?? yesterday;
  const from =
    parseIctDateYmd(url.searchParams.get('from')) ?? addIctDays(to, -59);
  if (from > to) {
    return NextResponse.json({ error: 'from must be on or before to' }, { status: 400 });
  }
  const key = `${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json(hit.body, { headers: { 'Cache-Control': 'no-store' } });
  }
  const trend = await scoreForecastTrend(from, to);
  if (!trend.ok) {
    return NextResponse.json({ error: trend.error, from, to }, { status: 500 });
  }
  cache.set(key, { at: Date.now(), body: trend });
  return NextResponse.json(trend, { headers: { 'Cache-Control': 'no-store' } });
}
