'use client';

import React from 'react';
import type { SamuiWeatherForecastRow } from '@/lib/spire';
import HybridRainHourlyStrip, { type HybridRadarScrubFrame } from './HybridRainHourlyStrip';

export type RadarScrubFrame = HybridRadarScrubFrame;

export default function RadarHourlyTimeline({
  lat,
  lon,
  product,
  className,
  forecastRows,
  windDirDeg = 0,
  radarScrub = null,
  onRadarScrub,
  onRadarOverlayUrl,
}: {
  lat: number;
  lon: number;
  product: 'krabi' | 'samui';
  className?: string;
  forecastRows?: SamuiWeatherForecastRow[];
  /** Surface wind FROM (°) — nudges raster translate per hour for scrub/play */
  windDirDeg?: number;
  radarScrub?: RadarScrubFrame | null;
  onRadarScrub?: (frame: RadarScrubFrame | null) => void;
  onRadarOverlayUrl?: (url: string | null) => void;
}) {
  return (
    <div
      className={[
        'pointer-events-auto rounded-xl border border-cyan-500/25 bg-slate-950/92 px-2 py-2 shadow-xl backdrop-blur-md sm:px-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role="region"
      aria-label="Recent rain from live radar at your map pin (last hours, Thailand time)"
    >
      <HybridRainHourlyStrip
        lat={lat}
        lon={lon}
        product={product}
        forecastRows={forecastRows ?? []}
        windDirDeg={windDirDeg}
        radarScrub={radarScrub}
        onRadarScrub={onRadarScrub}
        onRadarOverlayUrl={onRadarOverlayUrl}
        layout="map"
      />
    </div>
  );
}
