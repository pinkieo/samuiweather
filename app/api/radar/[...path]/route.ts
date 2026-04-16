import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

/** RainViewer public tile pyramid — never proxy tiles above this z (512px stack). */
const MAX_RADAR_ZOOM = 7;

// Proxy RainViewer tiles (tilecache.rainviewer.com).
// - Typical: …/512/{z}/{x}/{y}/2/1_1.png — max z = 7 (color scheme 2).
// - z > MAX_RADAR_ZOOM or upstream error → transparent 1×1 PNG so Mapbox stays quiet.

const TRANSPARENT_PNG = new Uint8Array([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
  0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
  0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,
  0x89,0x00,0x00,0x00,0x0b,0x49,0x44,0x41,
  0x54,0x78,0x9c,0x62,0x00,0x00,0x00,0x02,
  0x00,0x01,0xe5,0x27,0xde,0xfc,0x00,0x00,
  0x00,0x00,0x49,0x45,0x4e,0x44,0xae,0x42,
  0x60,0x82,
]);

function transparentResponse() {
  return new NextResponse(TRANSPARENT_PNG, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const tilePath = path.join('/');
  const upstreamUrl = `https://tilecache.rainviewer.com/${tilePath}`;

  // Tile zoom = first segment after /256/ or /512/ (not the frame id in v2/radar/{time}/…).
  const zoomMatch = tilePath.match(/\/(?:256|512)\/(\d+)\//);
  const requestedZoom = zoomMatch ? parseInt(zoomMatch[1], 10) : null;

  if (requestedZoom !== null && !Number.isFinite(requestedZoom)) {
    console.warn(`[Radar Proxy] Invalid zoom parse path=${tilePath}`);
    return transparentResponse();
  }

  if (requestedZoom !== null && requestedZoom > MAX_RADAR_ZOOM) {
    console.warn(
      `[Radar Proxy] High zoom blocked z=${requestedZoom} path=${tilePath}`,
    );
    return transparentResponse();
  }

  if (requestedZoom !== null && requestedZoom < 0) {
    console.warn(`[Radar Proxy] Negative zoom blocked z=${requestedZoom} path=${tilePath}`);
    return transparentResponse();
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'SamuiWeatherDashboard/1.0 (Koh Samui local weather app)',
      },
      next: { revalidate: 300 },
    });

    if (!upstream.ok) {
      console.warn(
        `[Radar Proxy] Upstream ${upstream.status} url=${upstreamUrl} path=${tilePath}`,
      );
      return transparentResponse();
    }

    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'image/png',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error(`[Radar Proxy] Fetch error path=${tilePath}`, err);
    return transparentResponse();
  }
}
