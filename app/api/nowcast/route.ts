import { NextResponse } from 'next/server';
import { getNowcast } from '@/lib/nowcast/service';

/**
 * EXPERIMENTAL rain-cell nowcast for Bo Phut (preview only).
 * GET /api/nowcast -> { status: "ok", verdict, frame, cells, ... } or { status: "unavailable", reason, detail } (HTTP 503).
 * Node runtime (PNG decoding); computed per request from the live RainViewer frames, never cached by the CDN.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  const body = await getNowcast();
  return NextResponse.json(body, {
    status: body.status === 'ok' ? 200 : 503,
    headers: {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
