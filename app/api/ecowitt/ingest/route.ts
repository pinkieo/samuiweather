import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_LOCATION_ID = 'baan_ton_kluay';

type EcowittPayload = Record<string, string>;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function firstValue(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function firstNumber(payload: EcowittPayload, keys: string[]): number | null {
  for (const key of keys) {
    const raw = payload[key];
    if (raw == null || raw.trim() === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function fahrenheitToCelsius(f: number | null): number | null {
  return f == null ? null : Math.round(((f - 32) * 5 / 9) * 100) / 100;
}

function mphToMs(mph: number | null): number | null {
  return mph == null ? null : Math.round(mph * 0.44704 * 100) / 100;
}

function inchToMm(inches: number | null): number | null {
  return inches == null ? null : Math.round(inches * 25.4 * 100) / 100;
}

function inHgToHpa(inHg: number | null): number | null {
  return inHg == null ? null : Math.round(inHg * 33.8638866667 * 100) / 100;
}

function mileToKm(miles: number | null): number | null {
  return miles == null ? null : Math.round(miles * 1.609344 * 100) / 100;
}

function parseObservedAt(payload: EcowittPayload): string {
  const raw = payload.dateutc ?? payload.date_utc ?? payload.time;
  if (raw) {
    const normalized = raw.trim().replace(' ', 'T');
    const iso = /Z$|[+-]\d\d:?\d\d$/.test(normalized)
      ? normalized
      : `${normalized}Z`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function payloadFromSearchParams(params: URLSearchParams): EcowittPayload {
  const out: EcowittPayload = {};
  params.forEach((value, key) => {
    if (key !== 'secret') out[key] = value;
  });
  return out;
}

async function readEcowittPayload(req: NextRequest): Promise<EcowittPayload> {
  const urlPayload = payloadFromSearchParams(new URL(req.url).searchParams);
  if (req.method === 'GET') return urlPayload;

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body === 'object') {
      return {
        ...urlPayload,
        ...Object.fromEntries(
          Object.entries(body as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        ),
      };
    }
  }

  const text = await req.text().catch(() => '');
  if (!text) return urlPayload;
  const params = new URLSearchParams(text);
  return { ...urlPayload, ...payloadFromSearchParams(params) };
}

function batteryStatusFromPayload(payload: EcowittPayload): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    const k = key.toLowerCase();
    if (k.includes('batt') || k.endsWith('battery')) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function buildDbRow(payload: EcowittPayload) {
  const locationId = payload.location_id?.trim() || DEFAULT_LOCATION_ID;
  return {
    observed_at: parseObservedAt(payload),
    location_id: locationId,
    station_type: payload.stationtype ?? payload.station_type ?? null,
    station_id: payload.PASSKEY ?? payload.passkey ?? payload.station_id ?? null,

    temperature_c: fahrenheitToCelsius(firstNumber(payload, ['tempf', 'outtempf'])),
    humidity_pct: firstNumber(payload, ['humidity', 'outhumidity']),
    indoor_temperature_c: fahrenheitToCelsius(firstNumber(payload, ['indoortempf', 'tempinf'])),
    indoor_humidity_pct: firstNumber(payload, ['indoorhumidity', 'humidityin']),

    relative_pressure_hpa: inHgToHpa(firstNumber(payload, ['baromrelin', 'baromrel'])),
    absolute_pressure_hpa: inHgToHpa(firstNumber(payload, ['baromabsin', 'baromabs'])),

    wind_speed_ms: mphToMs(firstNumber(payload, ['windspeedmph'])),
    wind_gust_ms: mphToMs(firstNumber(payload, ['windgustmph', 'maxdailygust'])),
    wind_direction_deg: firstNumber(payload, ['winddir']),

    rain_rate_mmh: inchToMm(firstNumber(payload, ['rainratein'])),
    rain_hour_mm: inchToMm(firstNumber(payload, ['hourlyrainin'])),
    rain_day_mm: inchToMm(firstNumber(payload, ['dailyrainin'])),
    rain_week_mm: inchToMm(firstNumber(payload, ['weeklyrainin'])),
    rain_month_mm: inchToMm(firstNumber(payload, ['monthlyrainin'])),
    rain_year_mm: inchToMm(firstNumber(payload, ['yearlyrainin'])),
    rain_event_mm: inchToMm(firstNumber(payload, ['eventrainin'])),

    solar_wm2: firstNumber(payload, ['solarradiation']),
    uv_index: firstNumber(payload, ['uv']),

    lightning_distance_km: mileToKm(firstNumber(payload, ['lightningdistancemi'])),
    lightning_count: firstNumber(payload, ['lightningcount']),

    battery_status: batteryStatusFromPayload(payload),
    raw_json: payload,
  };
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.ECOWITT_INGEST_SECRET?.trim();
  if (!expected) return false;
  const { searchParams } = new URL(req.url);
  const provided =
    firstValue(searchParams, 'secret') ??
    req.headers.get('x-ecowitt-secret')?.trim() ??
    '';
  return provided === expected;
}

async function handleIngest(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Server misconfigured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' },
      { status: 500 },
    );
  }

  const payload = await readEcowittPayload(req);
  const row = buildDbRow(payload);

  const { data, error } = await supabase
    .from('ecowitt_observations')
    .upsert(row, { onConflict: 'location_id,observed_at' })
    .select('id,observed_at')
    .single();

  if (error) {
    console.error('ecowitt/ingest:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, row: data });
}

export async function GET(req: NextRequest) {
  return handleIngest(req);
}

export async function POST(req: NextRequest) {
  return handleIngest(req);
}
