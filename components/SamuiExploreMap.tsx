'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import Map, { Layer, Marker, NavigationControl, ScaleControl, Source } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import type { ErrorEvent, Map as MapboxMap } from 'mapbox-gl';
import { ISLAND_POIS, type IslandPoi } from '../lib/island-pois';
import { SAMUI_SATELLITE_ONLY_STYLE } from '../lib/mapbox-satellite-only-style';
import { exploreMapTransformRequest } from '../lib/mapbox-satellite-tiles';

/** Cap parallel raster loads (sprites/tiles); avoids stalls when many tiles fire at once. */
mapboxgl.maxParallelImageRequests = 16;

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

/** Satellite detail for Koh Samui; radar overzooms above RainViewer z7 — no need for z18+. */
const MAP_MAX_ZOOM = 16;

/** ~5 km context at Koh Samui latitude — wider landing view (was ~z13, too tight). */
const INITIAL_MAP_ZOOM = 11;

/**
 * RainViewer public Weather Maps API: max native zoom **7** (512 px tiles per 2025/2026 docs).
 * `maxzoom` here must be 7 so Mapbox never requests z>7 from tilecache.
 */
const RADAR_RASTER_MAX_ZOOM = 7;
/** RainViewer 512 px tile grid — must match URL segment and `tileSize` on the raster source. */
const RADAR_TILE_SIZE = 512;
/** Above this map zoom: radar layer `visibility` → none (source may stay mounted until z15). */
const RADAR_LAYER_HIDE_ABOVE_ZOOM = 13;
/** Above this map zoom: unmount RainViewer `Source` (stops all radar tile requests). */
const RADAR_REMOVE_ABOVE_ZOOM = 15;

function clampMapZoom(map: MapboxMap) {
  map.setMaxZoom(MAP_MAX_ZOOM);
  const z = map.getZoom();
  if (z > MAP_MAX_ZOOM) {
    map.setZoom(MAP_MAX_ZOOM);
  }
}

/** `onError` (React) + `map.on('error')` in onLoad — log only, no rethrow. */
function handleMapError(e: ErrorEvent) {
  const msg = e.error?.message ?? String(e.error ?? 'Mapbox error');
  const ext = e as ErrorEvent & {
    sourceId?: string;
    tile?: { tileID?: { z: number; x: number; y: number } };
  };
  console.warn('[Samui map]', msg, {
    sourceId: ext.sourceId,
    tile: ext.tile?.tileID ?? ext.tile,
  }, e);
}

export interface SamuiExploreMapProps {
  /** Increment `key` when flying to the same coords again */
  flyToRequest?: { key: number; lng: number; lat: number; zoom?: number } | null;
  /** POI marker tap — parent renders panel above the drawer */
  onPoiSelect?: (poi: IslandPoi | null) => void;
}

/**
 * Proxied RainViewer tiles — must stay in sync with `app/api/radar/[...path]/route.ts`.
 * Same shape as: `/api/radar/${tilePath}/512/{z}/{x}/{y}/2/1_1.png`
 */
function buildRadarTileUrl(framePath: string): string {
  const tilePath = framePath.replace(/^\//, '');
  return `/api/radar/${tilePath}/512/{z}/{x}/{y}/2/1_1.png`;
}

const RADAR_PLAYER_INTERVAL_MS = 800;
const FRAMES_POLL_MS = 5 * 60 * 1000;

/** Koh Samui — Mapbox Satellite + RainViewer animated radar loop. */
export default function SamuiExploreMap({ flyToRequest = null, onPoiSelect }: SamuiExploreMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  /** Last 5 frame paths from `/api/radar/frames` (RainViewer `past` tail). */
  const [radarFrames, setRadarFrames] = useState<{ path: string; time: number }[]>([]);
  /** Cycles 0..frames.length-1 every {@link RADAR_PLAYER_INTERVAL_MS}. */
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  /** Wait for basemap + Mercator to settle before attaching RainViewer (avoids globe/tile glitches with overlays). */
  const [baseMapReady, setBaseMapReady] = useState(false);
  /** Tracks map zoom for radar visibility + conditional source mount (matches initialViewState.zoom). */
  const [viewZoom, setViewZoom] = useState(INITIAL_MAP_ZOOM);

  useEffect(() => {
    if (!flyToRequest) return;
    const m = mapRef.current;
    if (!m) return;
    m.flyTo({
      center: [flyToRequest.lng, flyToRequest.lat],
      zoom: Math.min(flyToRequest.zoom ?? 16, MAP_MAX_ZOOM),
      duration: 2200,
      essential: true,
    });
  }, [flyToRequest]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/radar/frames')
        .then(r => (r.ok ? r.json() : Promise.reject()))
        .then((data: { frames?: { path: string; time: number }[] }) => {
          if (cancelled) return;
          setRadarFrames(data.frames ?? []);
        })
        .catch(() => {
          if (!cancelled) setRadarFrames([]);
        });
    };
    load();
    const poll = window.setInterval(load, FRAMES_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    if (radarFrames.length === 0) return;
    setCurrentFrameIndex(i => i % radarFrames.length);
  }, [radarFrames]);

  useEffect(() => {
    if (radarFrames.length === 0) return;
    const id = window.setInterval(() => {
      setCurrentFrameIndex(i => (i + 1) % radarFrames.length);
    }, RADAR_PLAYER_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [radarFrames.length]);

  /** When zoom > 14, sync `viewZoom` so radar unmount/hide tracks Mapbox even if `move` events lag (pinch / controls). */
  useEffect(() => {
    if (!baseMapReady) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const onZoom = () => {
      const z = map.getZoom();
      if (z > 14) {
        setViewZoom(z);
      }
    };
    map.on('zoom', onZoom);
    return () => {
      map.off('zoom', onZoom);
    };
  }, [baseMapReady]);

  const activeRadarPath =
    radarFrames.length > 0
      ? radarFrames[currentFrameIndex % radarFrames.length]?.path ?? null
      : null;

  const radarTiles = useMemo(
    () => (activeRadarPath ? [buildRadarTileUrl(activeRadarPath)] : []),
    [activeRadarPath],
  );

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#020617] px-4 text-center text-xs text-slate-400">
        Set <code className="text-cyan-400">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{' '}
        <code className="text-cyan-400">.env.local</code> for explore mode.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-[#020617]">
      {/* Raster-only basemap (same as Mapbox-only tab) — hosted satellite-v9/globe can throw “zoom not supported” with overlays. */}
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle={SAMUI_SATELLITE_ONLY_STYLE}
        transformRequest={exploreMapTransformRequest}
        projection="mercator"
        antialias={false}
        preserveDrawingBuffer={false}
        initialViewState={{
          longitude: 100.0137,
          latitude: 9.512,
          zoom: INITIAL_MAP_ZOOM,
          bearing: 0,
          pitch: 0,
        }}
        minZoom={9}
        maxZoom={MAP_MAX_ZOOM}
        renderWorldCopies={false}
        reuseMaps={false}
        style={{ width: '100%', height: '100%' }}
        attributionControl
        scrollZoom
        boxZoom
        dragRotate={false}
        touchPitch={false}
        onClick={() => onPoiSelect?.(null)}
        onError={handleMapError}
        onMove={evt => {
          setViewZoom(evt.viewState.zoom);
        }}
        onLoad={() => {
          const map = mapRef.current?.getMap();
          if (!map) return;
          map.on('error', handleMapError);
          map.setProjection('mercator');
          clampMapZoom(map);
          setViewZoom(map.getZoom());
          const bumpResize = () => {
            map.resize();
          };
          bumpResize();
          requestAnimationFrame(bumpResize);
          window.setTimeout(bumpResize, 120);
          window.setTimeout(bumpResize, 500);
          // Re-sync viewport / zoom after style + tiles settle (helps overlay coordinate match vs satellite 256).
          window.setTimeout(() => {
            bumpResize();
            setViewZoom(map.getZoom());
          }, 300);
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            setBaseMapReady(true);
          };
          const fallbackMs = 8000;
          const t = window.setTimeout(finish, fallbackMs);
          map.once('idle', () => {
            window.clearTimeout(t);
            bumpResize();
            finish();
          });
        }}
        onMoveEnd={() => {
          const map = mapRef.current?.getMap();
          if (map && map.getZoom() > MAP_MAX_ZOOM) {
            map.setZoom(MAP_MAX_ZOOM);
          }
        }}
      >
        {baseMapReady &&
          radarTiles.length > 0 &&
          viewZoom <= RADAR_REMOVE_ABOVE_ZOOM && (
          <Source
            key={`rainviewer-${activeRadarPath ?? 'none'}`}
            id="rainviewer-radar"
            type="raster"
            tiles={radarTiles}
            tileSize={RADAR_TILE_SIZE}
            minzoom={0}
            maxzoom={RADAR_RASTER_MAX_ZOOM}
            scheme="xyz"
            crossOrigin="anonymous"
          >
            <Layer
              id="rainviewer-radar-layer"
              type="raster"
              layout={{
                visibility:
                  viewZoom > RADAR_LAYER_HIDE_ABOVE_ZOOM ? 'none' : 'visible',
              }}
              paint={{
                'raster-opacity': 0.72,
                'raster-fade-duration': 400,
                'raster-resampling': 'linear',
                'raster-brightness-min': 0,
                'raster-brightness-max': 1,
              }}
            />
          </Source>
        )}

        {ISLAND_POIS.map(poi => (
          <Marker
            key={poi.id}
            longitude={poi.lon}
            latitude={poi.lat}
            anchor="bottom"
            onClick={e => {
              e.originalEvent?.stopPropagation();
              onPoiSelect?.(poi);
            }}
          >
            <button
              type="button"
              className={[
                'flex -translate-y-1 cursor-pointer items-center justify-center rounded-full border-2 shadow-lg transition hover:scale-110',
                poi.kind === 'beach_club'
                  ? 'h-9 w-9 border-amber-400/80 bg-amber-500/25 text-lg'
                  : 'h-8 w-8 border-cyan-400/80 bg-cyan-500/20 text-sm',
              ].join(' ')}
              title={poi.name}
              aria-label={poi.name}
            >
              {poi.kind === 'beach_club' ? '🏖' : '🍽'}
            </button>
          </Marker>
        ))}

        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-left" unit="metric" />
      </Map>

      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="pointer-events-auto absolute bottom-24 right-3 flex max-w-[min(100%-1.5rem,22rem)] flex-col items-end gap-1 sm:bottom-28">
          <div
            className="rounded-full border border-cyan-500/35 bg-cyan-500/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-cyan-200 shadow-lg backdrop-blur-md"
            title="Animated loop from last 5 RainViewer frames"
          >
            🌧 Radar player · {radarFrames.length || '—'} frames · {RADAR_PLAYER_INTERVAL_MS}ms
          </div>
          <p className="rounded-lg border border-white/10 bg-slate-950/85 px-2 py-1 text-[8px] leading-snug text-slate-500 backdrop-blur-sm">
            {`RainViewer ${RADAR_TILE_SIZE}px · z≤${RADAR_RASTER_MAX_ZOOM} native; loop updates tile URL. Hidden above z13, off above z15. Spire + meteoblue in the panel.`}
          </p>
        </div>
      </div>
    </div>
  );
}
