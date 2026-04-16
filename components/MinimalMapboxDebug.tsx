'use client';

/**
 * Mapbox GL with no app overlays: same raster satellite basemap as Live, but no radar / POIs / cards.
 */
import React, { useRef } from 'react';
import Map, { NavigationControl } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import type { Map as MapboxMap } from 'mapbox-gl';
import { SAMUI_SATELLITE_ONLY_STYLE } from '../lib/mapbox-satellite-only-style';
import { mapboxSatelliteRasterRequest } from '../lib/mapbox-satellite-tiles';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const MAP_MAX_ZOOM = 16;

function clampMapZoom(map: MapboxMap) {
  map.setMaxZoom(MAP_MAX_ZOOM);
  const z = map.getZoom();
  if (z > MAP_MAX_ZOOM) map.setZoom(MAP_MAX_ZOOM);
}

export default function MinimalMapboxDebug() {
  const mapRef = useRef<MapRef | null>(null);

  if (!TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0a1628] px-4 text-center text-xs text-slate-400">
        Set <code className="text-cyan-400">NEXT_PUBLIC_MAPBOX_TOKEN</code> for Mapbox debug.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-[#020617]">
      <Map
        ref={mapRef}
        mapboxAccessToken={TOKEN}
        mapStyle={SAMUI_SATELLITE_ONLY_STYLE}
        transformRequest={mapboxSatelliteRasterRequest}
        projection="mercator"
        antialias={false}
        preserveDrawingBuffer={false}
        initialViewState={{
          longitude: 100.0137,
          latitude: 9.512,
          zoom: 12.9,
          bearing: 0,
          pitch: 0,
        }}
        minZoom={9}
        maxZoom={MAP_MAX_ZOOM}
        reuseMaps={false}
        style={{ width: '100%', height: '100%' }}
        attributionControl
        scrollZoom
        boxZoom
        dragRotate={false}
        touchPitch={false}
        onLoad={() => {
          const map = mapRef.current?.getMap();
          if (!map) return;
          map.setProjection('mercator');
          clampMapZoom(map);
        }}
        onMoveEnd={() => {
          const map = mapRef.current?.getMap();
          if (map && map.getZoom() > MAP_MAX_ZOOM) map.setZoom(MAP_MAX_ZOOM);
        }}
      >
        <NavigationControl position="top-right" showCompass={false} />
      </Map>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-[min(100%-2rem,22rem)] rounded-lg border border-white/15 bg-slate-950/90 px-3 py-2 text-[10px] text-slate-400 shadow-lg backdrop-blur-sm">
        Debug: Mapbox satellite only (raster, no vector roads) — no radar or POIs. Use console to compare with
        Live radar.
      </div>
    </div>
  );
}
