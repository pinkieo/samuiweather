'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import Map, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import type { ErrorEvent, Map as MapboxMap, RasterLayerSpecification } from 'mapbox-gl';
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
 * Initial center offset W + S of island centroid so NW coast (Bang Por / Maenam) sits
 * above/right of the bottom-left weather drawer instead of under it.
 */
const INITIAL_LNG = 100.0137 - 0.034;
const INITIAL_LAT = 9.512 - 0.02;

/**
 * RainViewer public Weather Maps API: max native zoom **7** (512 px tiles per 2025/2026 docs).
 * `maxzoom` here must be 7 so Mapbox never requests z>7 from tilecache.
 */
const RADAR_RASTER_MAX_ZOOM = 7;
/** RainViewer 512 px tile grid — must match URL segment and `tileSize` on the raster source. */
const RADAR_TILE_SIZE = 512;
/** Above this map zoom: radar layer `visibility` → none (still mounted; saves GPU while panning zoomed in). */
const RADAR_LAYER_HIDE_ABOVE_ZOOM = 13;
/**
 * Keep RainViewer `Source` mounted up to the same zoom as the map (`MAP_MAX_ZOOM`).
 * Previously z>15 unmounted the source — at max zoom (16) the overlay vanished entirely.
 */
const RADAR_REMOVE_ABOVE_ZOOM = MAP_MAX_ZOOM;

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
  initialLongitude?: number;
  initialLatitude?: number;
  initialZoom?: number;
  /** Koh Samui POI markers (hide for Krabi test tab). Default true */
  showIslandPois?: boolean;
}

/**
 * Proxied RainViewer tiles — must stay in sync with `app/api/radar/[...path]/route.ts`.
 * Same shape as: `/api/radar/${tilePath}/512/{z}/{x}/{y}/2/1_1.png`
 */
function buildRadarTileUrl(framePath: string): string {
  const tilePath = framePath.replace(/^\//, '');
  return `/api/radar/${tilePath}/512/{z}/{x}/{y}/2/1_1.png`;
}

/**
 * Static “latest scan” overlay (RainViewer-style): no frame loop — only the most recent
 * `past` scan is shown. Polls at RainViewer’s typical cadence (~10 min new scans) so we
 * pick up fresh frames soon after they appear, without animating through historical frames.
 */
export const radarDisplay = {
  /** Mapbox raster crossfade when the tile URL changes to a new scan */
  fadeTransitionMs: 2800,
  /** Refetch `/api/radar/frames` this often (ms) — align with RainViewer ~10 min updates */
  framesPollMs: 10 * 60 * 1000,
} as const;

/**
 * RainViewer only serves native zoom 0–7 (512 px tiles). Above that, Mapbox upscales each tile —
 * that exaggerates square boundaries. We lower opacity as user zooms in so the overlay stays
 * “weather hint” not a chunky grid. Slightly lower peak opacity = calmer overlay while tuning motion.
 */
const RADAR_OPACITY_PAINT: RasterLayerSpecification['paint'] = {
  'raster-opacity': [
    'interpolate',
    ['linear'],
    ['zoom'],
    9,
    0.48,
    10,
    0.42,
    11,
    0.36,
    12,
    0.32,
    13,
    0.28,
  ],
  'raster-fade-duration': radarDisplay.fadeTransitionMs,
  'raster-resampling': 'linear',
  'raster-brightness-min': 0,
  'raster-brightness-max': 1,
  /** Soften hard yellow/orange boundaries between RainViewer cells */
  'raster-contrast': -0.12,
  'raster-saturation': -0.1,
};

const MAP_MIN_ZOOM = 9;

/** Web Mercator: meters per pixel at latitude & zoom */
function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Nice round distance (m) and bar width (px) for a ~72px target bar */
function scaleBarDimensions(lat: number, zoom: number): { label: string; widthPx: number } {
  const mpp = metersPerPixel(lat, zoom);
  const targetPx = 72;
  const distM = mpp * targetPx;
  if (!Number.isFinite(distM) || distM <= 0 || !Number.isFinite(mpp)) {
    return { label: '—', widthPx: 0 };
  }
  const pow10 = 10 ** Math.floor(Math.log10(distM));
  const n = distM / pow10;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  const niceM = mult * pow10;
  const widthPx = Math.min(120, Math.max(24, niceM / mpp));
  const label =
    niceM >= 1000
      ? `${niceM % 1000 === 0 ? niceM / 1000 : (niceM / 1000).toFixed(1)} km`
      : `${Math.round(niceM)} m`;
  return { label, widthPx };
}

/** Koh Samui — Mapbox Satellite + RainViewer latest-scan radar overlay. */
export default function SamuiExploreMap({
  flyToRequest = null,
  onPoiSelect,
  initialLongitude,
  initialLatitude,
  initialZoom,
  showIslandPois = true,
}: SamuiExploreMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const startLng = initialLongitude ?? INITIAL_LNG;
  const startLat = initialLatitude ?? INITIAL_LAT;
  const startZoom = initialZoom ?? INITIAL_MAP_ZOOM;
  /** Frame list from `/api/radar/frames` (~last hour) or `public/radar-practice.json` in practice mode. */
  const [radarFrames, setRadarFrames] = useState<{ path: string; time: number }[]>([]);
  /** Wait for basemap + Mercator to settle before attaching RainViewer (avoids globe/tile glitches with overlays). */
  const [baseMapReady, setBaseMapReady] = useState(false);
  /** Tracks map zoom for radar visibility + conditional source mount (matches initialViewState.zoom). */
  const [viewZoom, setViewZoom] = useState(startZoom);
  /** Center latitude for scale bar (Mercator m/px depends on lat). */
  const [centerLat, setCenterLat] = useState(startLat);

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
    const load = async () => {
      const useFixture = process.env.NEXT_PUBLIC_RADAR_PRACTICE === '1';
      if (useFixture) {
        try {
          const r = await fetch('/radar-practice.json', { cache: 'no-store' });
          if (r.ok) {
            const data: { frames?: { path: string; time: number }[] } = await r.json();
            const frames = data.frames ?? [];
            if (frames.length > 0) {
              if (!cancelled) setRadarFrames(frames);
              return;
            }
          }
        } catch {
          /* fall through to live API */
        }
        if (!cancelled) {
          console.warn(
            '[radar] NEXT_PUBLIC_RADAR_PRACTICE=1 but radar-practice.json missing or empty — using /api/radar/frames',
          );
        }
      }
      try {
        const r = await fetch('/api/radar/frames');
        const data: { frames?: { path: string; time: number }[] } = r.ok
          ? await r.json()
          : { frames: [] };
        if (!cancelled) setRadarFrames(data.frames ?? []);
      } catch {
        if (!cancelled) setRadarFrames([]);
      }
    };
    void load();
    const poll = window.setInterval(() => void load(), radarDisplay.framesPollMs);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, []);

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

  /** Newest scan in the list (by RainViewer `time`, unix seconds). */
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

  const latestScanClockLabel = useMemo(() => {
    if (!latestRadarFrame?.time) return null;
    return new Date(latestRadarFrame.time * 1000).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [latestRadarFrame]);

  const radarTiles = useMemo(
    () => (activeRadarPath ? [buildRadarTileUrl(activeRadarPath)] : []),
    [activeRadarPath],
  );

  /** Remount Source when the active scan path changes — keeps react-map-gl and Mapbox in sync. */
  const radarSourceIdentity = activeRadarPath ?? 'empty';

  /**
   * react-map-gl `Source` only applies `setTiles` when **tiles** is the sole changed prop.
   * A new `<Layer>` element every render counts as a second change → update skipped → radar stuck/blank.
   * Keep one stable Layer element unless zoom visibility actually changes.
   */
  const radarRasterLayer = useMemo(
    () => (
      <Layer
        id="rainviewer-radar-layer"
        type="raster"
        layout={{
          visibility:
            viewZoom > RADAR_LAYER_HIDE_ABOVE_ZOOM ? 'none' : 'visible',
        }}
        paint={RADAR_OPACITY_PAINT}
      />
    ),
    [viewZoom],
  );

  /**
   * Imperative tile URL updates — reliable even when Source+Layer both re-render (see note above).
   */
  useEffect(() => {
    if (!baseMapReady || radarTiles.length === 0) return;
    const map = mapRef.current?.getMap();
    if (!map?.isStyleLoaded()) return;
    try {
      const src = map.getSource('rainviewer-radar') as
        | { setTiles?: (tiles: string[]) => void }
        | undefined;
      src?.setTiles?.(radarTiles);
    } catch {
      /* source not mounted yet */
    }
  }, [baseMapReady, radarTiles]);

  const scaleBar = useMemo(
    () => scaleBarDimensions(centerLat, viewZoom),
    [centerLat, viewZoom],
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
          longitude: startLng,
          latitude: startLat,
          zoom: startZoom,
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
          setCenterLat(evt.viewState.latitude);
        }}
        onLoad={() => {
          const map = mapRef.current?.getMap();
          if (!map) return;
          map.on('error', handleMapError);
          map.setProjection('mercator');
          clampMapZoom(map);
          setViewZoom(map.getZoom());
          setCenterLat(map.getCenter().lat);
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
            key={radarSourceIdentity}
            id="rainviewer-radar"
            type="raster"
            tiles={radarTiles}
            tileSize={RADAR_TILE_SIZE}
            minzoom={0}
            maxzoom={RADAR_RASTER_MAX_ZOOM}
            scheme="xyz"
            crossOrigin="anonymous"
          >
            {radarRasterLayer}
          </Source>
        )}

        {showIslandPois &&
          ISLAND_POIS.map(poi => (
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
      </Map>

      {/* Right column: zoom + scale + radar legend, then Sammi (portal target from MapViewer) */}
      <div className="pointer-events-none absolute right-3 top-[4.25rem] z-[15] flex w-[min(21rem,calc(100%-1rem))] max-w-[21rem] flex-col items-stretch gap-2 sm:top-[4.5rem]">
        <div className="ml-auto flex w-[11.5rem] flex-col gap-2">
        <div className="pointer-events-none rounded-xl border border-white/15 bg-slate-950/90 px-3 py-2.5 shadow-xl backdrop-blur-md">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Zoom</p>
          <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-white">
            z = {viewZoom.toFixed(2)}
          </p>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
            title={`Map zoom ${MAP_MIN_ZOOM}–${MAP_MAX_ZOOM}`}
            role="img"
            aria-label={`Zoom level ${viewZoom.toFixed(2)} out of ${MAP_MIN_ZOOM} to ${MAP_MAX_ZOOM}`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-[width] duration-75"
              style={{
                width: `${Math.min(
                  100,
                  Math.max(
                    0,
                    ((viewZoom - MAP_MIN_ZOOM) / (MAP_MAX_ZOOM - MAP_MIN_ZOOM)) * 100,
                  ),
                )}%`,
              }}
            />
          </div>
          <p className="mt-1 text-[8px] text-slate-500">
            {MAP_MIN_ZOOM} island · {MAP_MAX_ZOOM} detail
          </p>
        </div>

        <div className="pointer-events-none rounded-xl border border-white/15 bg-slate-950/90 px-3 py-2.5 shadow-xl backdrop-blur-md">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Scale</p>
          <p className="mt-1 text-[8px] text-slate-500">At map center · metric</p>
          <div className="mt-2 flex items-end gap-2">
            <div
              className="h-2 shrink-0 rounded-sm bg-gradient-to-r from-white via-white to-white/50"
              style={{ width: `${scaleBar.widthPx}px` }}
            />
            <span className="font-mono text-[11px] font-bold tabular-nums text-cyan-200">
              {scaleBar.label}
            </span>
          </div>
        </div>

        <div className="pointer-events-none rounded-xl border border-white/15 bg-slate-950/90 px-3 py-2.5 shadow-xl backdrop-blur-md">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Radar</p>
          <p className="mt-0.5 text-[8px] leading-snug text-slate-500">
            RainViewer reflectivity (proxy) · opacity eases when zoomed in (native z≤7)
          </p>
          <div
            className="mt-2 h-3 w-full rounded-md shadow-inner"
            style={{
              background:
                'linear-gradient(90deg, #00ff00 0%, #ffff00 35%, #ff8800 65%, #ff0000 100%)',
            }}
            title="Light to heavy precipitation"
          />
          <div className="mt-1 flex justify-between text-[8px] font-semibold text-slate-400">
            <span>Light</span>
            <span>Heavy</span>
          </div>
        </div>
        </div>

        <div
          id="sammi-chat-anchor"
          className="pointer-events-auto mt-1 flex h-[min(62vh,34rem)] min-h-[20rem] w-full max-h-[calc(100dvh-8rem)] flex-col overflow-hidden overscroll-contain [scrollbar-gutter:stable]"
          aria-label="Sammi concierge chat"
        />
      </div>

      {/* RainViewer — bottom-left */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="pointer-events-auto absolute bottom-24 left-3 flex max-w-[min(100%-1.5rem,22rem)] flex-col items-start gap-1 sm:bottom-28">
          <div
            className="rounded-full border border-cyan-500/35 bg-cyan-500/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-cyan-200 shadow-lg backdrop-blur-md"
            title="Latest RainViewer scan only — no animation loop. Map crossfades when a newer scan appears after refresh."
          >
            🌧 Radar · latest scan{latestScanClockLabel ? ` · ${latestScanClockLabel}` : ''} · refresh{' '}
            {Math.round(radarDisplay.framesPollMs / 60000)}m · fade {radarDisplay.fadeTransitionMs}ms
          </div>
          <p className="rounded-lg border border-white/10 bg-slate-950/85 px-2 py-1 text-[8px] leading-snug text-slate-500 backdrop-blur-sm">
            {`RainViewer ${RADAR_TILE_SIZE}px · z≤${RADAR_RASTER_MAX_ZOOM} native; one static picture, updates when polling finds a newer frame. Layer hidden above z${RADAR_LAYER_HIDE_ABOVE_ZOOM}. Spire + meteoblue in the panel.`}
          </p>
        </div>
      </div>
    </div>
  );
}
