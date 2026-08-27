import { NextResponse } from 'next/server';
import { getSamuiForecastMerged, type SamuiWeatherForecastRow } from '@/lib/spire';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  CACHE_CONTROL_NO_STORE,
  SAMUI_PLACE,
  buildProvenance,
  provenanceHeaders,
  type WeatherProvenance,
} from '@/lib/weather-provenance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

export interface WeatherApiResponse {
  location: { name: string; lat: number; lon: number };
  freshness: WeatherProvenance;
  forecast: SamuiWeatherForecastRow[];
}

function emptyRow(timeIso: string, r: Record<string, unknown>): SamuiWeatherForecastRow {
  const n = (k: string): number => {
    const v = r[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  return {
    time: timeIso,
    temp: n('air_temperature_c'),
    feelsLike: n('air_temperature_c'),
    windSpeed: n('wind_speed_ms'),
    windGust: n('wind_gust_ms'),
    windDir: n('wind_direction_deg'),
    precip: 0,
    humidity: n('relative_humidity'),
    precipRate: n('precipitation_rate'),
    uvIndex: null,
    pm25: null,
    aqi: null,
    aqiStatus: null,
    cloudCover: n('total_cloud_cover'),
    pop: n('probability_of_precipitation_1hr'),
    cape: typeof r.cape === 'number' ? r.cape : null,
    pwat: typeof r.pwat === 'number' ? r.pwat : null,
    cin: typeof r.cin === 'number' ? r.cin : null,
    station: null,
  };
}

async function supabaseFallback(): Promise<{
  rows: SamuiWeatherForecastRow[];
  issuedAt: string | null;
  updatedAt: string | null;
} | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const locationId = process.env.WEATHER_LOCATION_ID?.trim() || 'samui_opf_hybrid';
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from('weather_forecast')
    .select(
      'valid_time_utc,issuance_time_utc,updated_at,air_temperature_c,wind_speed_ms,wind_gust_ms,wind_direction_deg,relative_humidity,precipitation_rate,total_cloud_cover,probability_of_precipitation_1hr,cape,pwat,cin',
    )
    .eq('location_id', locationId)
    .gte('valid_time_utc', nowIso)
    .order('valid_time_utc', { ascending: true })
    .limit(400);
  if (error || !data?.length) return null;
  return {
    rows: data.map(r => emptyRow(String(r.valid_time_utc), r as Record<string, unknown>)),
    issuedAt: data[0]?.issuance_time_utc ? String(data[0].issuance_time_utc) : null,
    updatedAt: data[0]?.updated_at ? String(data[0].updated_at) : null,
  };
}

export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  const fetchedAt = Math.floor(Date.now() / 1000);

  try {
    const forecast = await getSamuiForecastMerged(controller.signal);
    clearTimeout(timer);
    if (forecast.length === 0) {
      throw new Error('No forecast data');
    }
    const freshness = buildProvenance({
      source: 'spire',
      staleAfterMinutes: 90,
      issuedAtIso: forecast[0]?.time ?? null,
      nowUnix: fetchedAt,
      place: SAMUI_PLACE.name,
      lat: SAMUI_PLACE.lat,
      lon: SAMUI_PLACE.lon,
    });
    const body: WeatherApiResponse = {
      location: SAMUI_PLACE,
      freshness,
      forecast,
    };
    return NextResponse.json(body, { headers: provenanceHeaders(freshness) });
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const fallback = await supabaseFallback();
    if (fallback && fallback.rows.length > 0) {
      const freshness = buildProvenance({
        source: 'supabase_forecast',
        staleAfterMinutes: 90,
        issuedAtIso: fallback.issuedAt ?? fallback.updatedAt,
        nowUnix: fetchedAt,
        place: SAMUI_PLACE.name,
        lat: SAMUI_PLACE.lat,
        lon: SAMUI_PLACE.lon,
      });
      const body: WeatherApiResponse = {
        location: SAMUI_PLACE,
        freshness,
        forecast: fallback.rows,
      };
      return NextResponse.json(body, {
        headers: {
          ...provenanceHeaders(freshness),
          'X-Weather-Fallback': 'supabase',
        },
      });
    }
    if (message.includes('SPIRE_API_TOKEN')) {
      return NextResponse.json(
        { error: message },
        { status: 500, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Timeout: API did not respond' },
        { status: 504, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
      );
    }
    console.error('API Route Error:', error);
    return NextResponse.json(
      { error: 'Data fetch failed' },
      { status: 500, headers: { 'Cache-Control': CACHE_CONTROL_NO_STORE } },
    );
  }
}
