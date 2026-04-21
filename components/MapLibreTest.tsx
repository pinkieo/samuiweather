'use client';

/**
 * Sandbox-only MapLibre map + RainViewer radar from `public/radar-practice.fixture.json`.
 * Basemap + radar paint match `SamuiExploreMap` (Krabi + Samui dashboard).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Map, { Layer, NavigationControl, Source } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import type { RasterLayerSpecification, RequestParameters, ResourceType, StyleSpecification } from 'maplibre-gl';
import { fetchExploreBasemapStyle } from '@/lib/krabi-vector-style';
import { applyPreferredPlaceLabels } from '@/lib/maplibre-place-labels';
import { useHudThrottleMove } from '@/lib/map-move-hud';

const MAP_MAX_ZOOM = 16;
const INITIAL_MAP_ZOOM = 11;
const INITIAL_LNG = 100.0137 - 0.034;
const INITIAL_LAT = 9.512 - 0.02;

const RADAR_RASTER_MAX_ZOOM = 7;
const RADAR_TILE_SIZE = 512;

const radarDisplay = { fadeTransitionMs: 1100 } as const;

/** Same RainViewer tuning as `SamuiExploreMap`. */
const RADAR_OPACITY_PAINT: RasterLayerSpecification['paint'] = {
  'raster-opacity': 0.95,
  'raster-fade-duration': radarDisplay.fadeTransitionMs,
  'raster-resampling': 'linear',
  'raster-brightness-min': 0.24,
  'raster-brightness-max': 1,
  'raster-saturation': 0.6,
  'raster-contrast': 0.32,
};

function buildRadarTileUrl(framePath: string): string {
  const tilePath = framePath.replace(/^\//, '');
  return `/api/radar/${tilePath}/512/{z}/{x}/{y}/2/1_1.png`;
}

/** Same-origin credentials for proxied `/api/radar/...` tiles. */
function transformRequest(url: string, _resourceType?: ResourceType): RequestParameters {
  if (typeof window !== 'undefined') {
    try {
      const u = new URL(url, window.location.href);
      if (u.origin === window.location.origin) {
        return { url, credentials: 'same-origin' };
      }
    } catch {
      /* ignore */
    }
  }
  return { url };
}

function clampMapZoom(map: maplibregl.Map) {
  map.setMaxZoom(MAP_MAX_ZOOM);
  const z = map.getZoom();
  if (z > MAP_MAX_ZOOM) map.setZoom(MAP_MAX_ZOOM);
}

export default function MapLibreTest() {
  const mapRef = useRef<MapRef>(null);
  const [mapStyle, setMapStyle] = useState<StyleSpecification | null>(null);
  const [radarFrames, setRadarFrames] = useState<{ path: string; time: number }[]>([]);
  const [baseMapReady, setBaseMapReady] = useState(false);
  const [viewZoom, setViewZoom] = useState(INITIAL_MAP_ZOOM);
  const [fixtureMeta, setFixtureMeta] = useState<string | null>(null);

  const applyMoveHud = useCallback((zoom: number, _lat: number) => {
    setViewZoom(zoom);
  }, []);

  const onMoveHud = useHudThrottleMove(applyMoveHud);

  useEffect(() => {
    let cancelled = false;
    void fetchExploreBasemapStyle().then(style => {
      if (!cancelled) setMapStyle(style);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/radar-practice.fixture.json', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const data: {
          frames?: { path: string; time: number }[];
          savedAt?: string;
        } = await r.json();
        const frames = data.frames ?? [];
        if (!cancelled) {
          setRadarFrames(frames);
          setFixtureMeta(data.savedAt ?? null);
        }
      } catch {
        if (!cancelled) setRadarFrames([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const latestRadarFrame = useMemo(() => {
    if (radarFrames.length === 0) return null;
    let best = radarFrames[0]!;
    for (let i = 1; i < radarFrames.length; i++) {
      const f = radarFrames[i]!;
      if (f.time > best.time) best = f;
    }
    return best;
  }, [radarFrames]);

  const activeRadarPath = latestRadarFrame?.path ?? null;
  const radarTiles = useMemo(
    () => (activeRadarPath ? [buildRadarTileUrl(activeRadarPath)] : []),
    [activeRadarPath],
  );
  const radarSourceIdentity = activeRadarPath ?? 'empty';

  const radarRasterLayer = useMemo(
    () => <Layer id="rainviewer-radar-layer" type="raster" paint={RADAR_OPACITY_PAINT} />,
    [],
  );

  useEffect(() => {
    if (!baseMapReady || radarTiles.length === 0) return;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const map = mapRef.current?.getMap();
      if (!map?.isStyleLoaded()) return;
      try {
        const src = map.getSource('rainviewer-radar') as
          | { setTiles?: (tiles: string[]) => void }
          | undefined;
        src?.setTiles?.(radarTiles);
      } catch {
        /* not ready */
      }
    };
    apply();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) apply();
      });
    });
    return () => {
      cancelled = true;
    };
  }, [baseMapReady, radarTiles]);

  if (!mapStyle) {
    return <div className="relative h-full w-full min-h-[200px] bg-[#d4d2ce]" aria-hidden />;
  }

  return (
    <div className="relative h-full w-full bg-[#d4d2ce]">
      <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-lg border border-amber-500/40 bg-amber-950/90 px-3 py-2 text-[11px] text-amber-100 shadow-lg">
        <p className="font-bold uppercase tracking-wide text-amber-300">Sandbox · MapLibre</p>
        <p className="mt-1 text-amber-100/80">
          {process.env.NEXT_PUBLIC_MAPTILER_API_KEY || process.env.NEXT_PUBLIC_MAPTILER_KEY
            ? 'Same basemap as dashboard (MapTiler EN + muted bg)'
            : 'OSM fallback — set NEXT_PUBLIC_MAPTILER_API_KEY for EN labels + streets'}
        </p>
        <p className="mt-1 font-mono text-[10px] text-amber-200/60">
          Fixture: {radarFrames.length} frames
          {fixtureMeta ? ` · saved ${fixtureMeta}` : ''}
        </p>
      </div>

      <Map
        ref={mapRef}
        mapLib={maplibregl}
        mapStyle={mapStyle}
        key={mapStyle.name ?? 'explore-basemap'}
        maxParallelImageRequests={16}
        transformRequest={transformRequest}
        projection="mercator"
        initialViewState={{
          longitude: INITIAL_LNG,
          latitude: INITIAL_LAT,
          zoom: INITIAL_MAP_ZOOM,
          bearing: 0,
          pitch: 0,
        }}
        minZoom={9}
        maxZoom={MAP_MAX_ZOOM}
        renderWorldCopies={false}
        reuseMaps={false}
        style={{ width: '100%', height: '100%' }}
        attributionControl={{}}
        scrollZoom
        boxZoom
        dragRotate={false}
        touchPitch={false}
        onMove={onMoveHud}
        onLoad={() => {
          const map = mapRef.current?.getMap();
          if (!map) return;
          map.on('error', e => {
            console.warn('[MapLibre sandbox]', e.error?.message ?? e);
          });
          clampMapZoom(map);
          setViewZoom(map.getZoom());
          const bumpResize = () => map.resize();
          bumpResize();
          requestAnimationFrame(bumpResize);
          window.setTimeout(bumpResize, 120);
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            setBaseMapReady(true);
          };
          const t = window.setTimeout(finish, 8000);
          map.once('idle', () => {
            window.clearTimeout(t);
            applyPreferredPlaceLabels(map);
            bumpResize();
            finish();
          });
        }}
        onMoveEnd={() => {
          const map = mapRef.current?.getMap();
          if (!map) return;
          if (map.getZoom() > MAP_MAX_ZOOM) map.setZoom(MAP_MAX_ZOOM);
          setViewZoom(map.getZoom());
        }}
      >
        {baseMapReady && radarTiles.length > 0 && (
          <Source
            key={radarSourceIdentity}
            id="rainviewer-radar"
            type="raster"
            tiles={radarTiles}
            tileSize={RADAR_TILE_SIZE}
            minzoom={0}
            maxzoom={RADAR_RASTER_MAX_ZOOM}
            scheme="xyz"
          >
            {radarRasterLayer}
          </Source>
        )}
        <NavigationControl position="top-right" />
      </Map>

      <div className="pointer-events-none absolute bottom-4 left-3 z-20 max-w-[min(100%-1.5rem,22rem)] rounded-lg border border-white/10 bg-slate-950/90 px-3 py-2 text-[10px] text-slate-400">
        <p className="font-mono text-slate-200">z = {viewZoom.toFixed(2)}</p>
        <p className="mt-1 text-[9px] text-slate-500">
          Latest scan from fixture · tiles via /api/radar
        </p>
      </div>
    </div>
  );
}
