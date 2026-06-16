import { NextRequest, NextResponse } from 'next/server';
import type { EcowittPayload } from '@/lib/ecowitt-payload';
import { upsertEcowittObservation } from '@/lib/ecowitt-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function firstValue(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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

function isAuthorized(req: NextRequest, payload: EcowittPayload): boolean {
  const ingestSecret = process.env.ECOWITT_INGEST_SECRET?.trim();
  const stationPasskey = process.env.ECOWITT_PASSKEY?.trim();

  const { searchParams } = new URL(req.url);
  const providedSecret =
    firstValue(searchParams, 'secret') ??
    req.headers.get('x-ecowitt-secret')?.trim() ??
    '';

  if (ingestSecret && providedSecret === ingestSecret) return true;

  const payloadPasskey =
    payload.PASSKEY?.trim() ??
    payload.passkey?.trim() ??
    payload.station_id?.trim() ??
    '';

  if (stationPasskey && payloadPasskey === stationPasskey) return true;
  if (ingestSecret && payloadPasskey === ingestSecret) return true;

  return false;
}

async function handleIngest(req: NextRequest) {
  const payload = await readEcowittPayload(req);

  if (!isAuthorized(req, payload)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await upsertEcowittObservation(payload);
  if (!result.ok) {
    console.error('ecowitt/ingest:', result.error);
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, row: { id: result.id, observed_at: result.observedAt } });
}

export async function GET(req: NextRequest) {
  return handleIngest(req);
}

export async function POST(req: NextRequest) {
  return handleIngest(req);
}
