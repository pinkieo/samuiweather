'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';

/**
 * Map + dashboard must be client-only (Mapbox, etc.).
 * `ssr: false` is only valid inside a Client Component (Next.js 15).
 * Also avoids hydration noise from browser extensions on form controls.
 */
const MapViewer = dynamic(() => import('@/components/MapViewer'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[100dvh] w-full items-center justify-center bg-[#020617] text-[10px] text-slate-500">
      Loading map…
    </div>
  ),
});

export default function MapViewerClient() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return <MapViewer />;
}
