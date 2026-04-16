import { NextResponse } from 'next/server';

const LAT = 9.512;
const LON = 100.0136;
const TIMEOUT_MS = 5000;

export interface UVData {
  uv: number;
  uvMax: number;
  uvMaxTime: string;
  /** Minutes to burn for skin type II (fair skin) */
  burnMinutes: number | null;
  safeExposureMinutes: Record<string, number | null>;
  ozone: number;
  updatedAt: string;
}

export const revalidate = 3600;

export async function GET() {
  const key = process.env.NEXT_PUBLIC_OPENUV_API_KEY;
  console.log('[uvindex] key aanwezig:', !!key);

  if (!key) {
    console.error('[uvindex] NEXT_PUBLIC_OPENUV_API_KEY ontbreekt in .env.local');
    return NextResponse.json({ error: 'NEXT_PUBLIC_OPENUV_API_KEY niet ingesteld' }, { status: 500 });
  }

  const url = `https://api.openuv.io/api/v1/uv?lat=${LAT}&lng=${LON}`;
  console.log('[uvindex] fetch →', url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { 'x-access-token': key },
      signal: controller.signal,
      next: { revalidate: 1800 },
    });
    clearTimeout(timer);
    console.log('[uvindex] HTTP status:', res.status);

    if (res.status === 401) throw new Error('OpenUV 401 – ongeldige API key');
    if (res.status === 429) throw new Error('OpenUV 429 – te veel verzoeken (daily limit)');
    if (!res.ok) throw new Error(`OpenUV HTTP ${res.status}`);

    const json = (await res.json()) as {
      result?: {
        uv: number;
        uv_max: number;
        uv_max_time: string;
        ozone: number;
        safe_exposure_time?: Record<string, number | null>;
      };
      error?: string;
    };

    console.log('[uvindex] response keys:', Object.keys(json));

    if (json.error) throw new Error(`OpenUV API fout: ${json.error}`);
    if (!json.result) throw new Error('OpenUV: geen result in response');

    const r = json.result;
    const burnMinutes = r.safe_exposure_time?.st2 ?? null;

    const result: UVData = {
      uv: Math.round(r.uv * 10) / 10,
      uvMax: Math.round(r.uv_max * 10) / 10,
      uvMaxTime: r.uv_max_time,
      burnMinutes,
      safeExposureMinutes: r.safe_exposure_time ?? {},
      ozone: Math.round(r.ozone),
      updatedAt: new Date().toISOString(),
    };

    console.log('[uvindex] ✓ UV nu:', result.uv, '| max:', result.uvMax);
    return NextResponse.json(result);
  } catch (err) {
    clearTimeout(timer);
    const message =
      err instanceof Error
        ? err.name === 'AbortError'
          ? 'OpenUV API timeout (>5s)'
          : err.message
        : 'Fetch fout';
    console.error('[uvindex] fout:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
