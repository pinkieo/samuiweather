'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Map, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import type { ErrorEvent, RasterLayerSpecification, StyleSpecification } from 'maplibre-gl';
import { ISLAND_POIS, type IslandPoi } from '../lib/island-pois';
import { fetchExploreBasemapStyle } from '../lib/krabi-vector-style';
import { applyPreferredPlaceLabels } from '../lib/maplibre-place-labels';

/** Satellite detail; radar overzooms above RainViewer z7 — no need for z18+. */
const MAP_MAX_ZOOM = 16;

/**
 * Exacte locatie Baan Mook Taley — Long Beach, Ao Nang, Krabi (national park kust).
 * Parent `initial*` props override when set (e.g. MapViewer region).
 */
const INITIAL_LNG = 98.78503;
const INITIAL_LAT = 8.04561;
/** Overzicht Krabi-kust (~z9); parent `initialZoom` overschrijft. */
const INITIAL_MAP_ZOOM = 9;

/**
 * RainViewer public Weather Maps API: max native zoom **7** (512 px tiles per 2025/2026 docs).
 * `maxzoom` here must be 7 so the map never requests z>7 from tilecache.
 */
const RADAR_RASTER_MAX_ZOOM = 7;
/** RainViewer 512 px tile grid — must match URL segment and `tileSize` on the raster source. */
const RADAR_TILE_SIZE = 512;

function clampMapZoom(map: maplibregl.Map) {
  map.setMaxZoom(MAP_MAX_ZOOM);
  const z = map.getZoom();
  if (z > MAP_MAX_ZOOM) {
    map.setZoom(MAP_MAX_ZOOM);
  }
}

function handleMapError(e: ErrorEvent) {
  const msg = e.error?.message ?? String(e.error ?? 'MapLibre error');
  const ext = e as ErrorEvent & {
    sourceId?: string;
    tile?: { tileID?: { z: number; x: number; y: number } };
  };
  console.warn('[SamuiExploreMap]', msg, {
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
  /** Villa / rain station — shown when not using island POIs (e.g. Baan Mook Taley). */
  homeLocationPin?: { lat: number; lng: number; label: string } | null;
  /** Shown in zoom HUD, e.g. `island` vs `coast`. */
  mapScaleContextLabel?: string;
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
  /** MapLibre raster crossfade when the tile URL changes to a new scan */
  fadeTransitionMs: 1100,
  /** Refetch `/api/radar/frames` this often (ms) — align with RainViewer ~10 min updates */
  framesPollMs: 10 * 60 * 1000,
} as const;

/** RainViewer — sterke, verzadigde overlay op muted basemap (diepe blauwen, scherpe kernen). */
const RADAR_OPACITY_PAINT: RasterLayerSpecification['paint'] = {
  'raster-opacity': 0.95,
  'raster-fade-duration': radarDisplay.fadeTransitionMs,
  'raster-resampling': 'linear',
  'raster-brightness-min': 0.24,
  'raster-brightness-max': 1,
  'raster-saturation': 0.6,
  'raster-contrast': 0.32,
};

const MAP_MIN_ZOOM = 8;

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

/** Tropical OSM basemap + RainViewer radar; Koh Samui POIs or `homeLocationPin` (Krabi). */
export default function SamuiExploreMap({
  flyToRequest = null,
  onPoiSelect,
  initialLongitude,
  initialLatitude,
  initialZoom,
  showIslandPois = true,
  homeLocationPin = null,
  mapScaleContextLabel = 'island',
}: SamuiExploreMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const startLng = initialLongitude ?? INITIAL_LNG;
  const startLat = initialLatitude ?? INITIAL_LAT;
  const startZoom = initialZoom ?? INITIAL_MAP_ZOOM;
  /** Live: `/api/radar/frames`. Practice: `public/radar-practice.json` (local) or `radar-practice.fixture.json` (repo). */
  const [radarFrames, setRadarFrames] = useState<{ path: string; time: number }[]>([]);
  /** Wait for basemap + Mercator to settle before attaching RainViewer (avoids tile glitches with overlays). */
  const [baseMapReady, setBaseMapReady] = useState(false);
  /** Map zoom for UI (scale bar, zoom readout). */
  const [viewZoom, setViewZoom] = useState(startZoom);
  /** Center latitude for scale bar (Mercator m/px depends on lat). */
  const [centerLat, setCenterLat] = useState(startLat);
  /** MapTiler streets (EN) when key set; else muted OSM raster — shared Krabi + Samui dashboard tabs. */
  const [mapStyle, setMapStyle] = useState<StyleSpecification | null>(null);
  /** Sammi chat panel — toggle keeps same width as Zoom / Scale / Radar (11.5rem). */
  const [sammiPanelOpen, setSammiPanelOpen] = useState(true);

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
    let pollId: number | undefined;

    async function loadLiveFrames() {
      try {
        const r = await fetch('/api/radar/frames');
        const data: { frames?: { path: string; time: number }[] } = r.ok
          ? await r.json()
          : { frames: [] };
        if (!cancelled) setRadarFrames(data.frames ?? []);
      } catch {
        if (!cancelled) setRadarFrames([]);
      }
    }

    async function tryLoadPracticeSnapshot(): Promise<boolean> {
      for (const url of ['/radar-practice.json', '/radar-practice.fixture.json'] as const) {
        try {
          const r = await fetch(url, { cache: 'no-store' });
          if (!r.ok) continue;
          const data: { frames?: { path: string; time: number }[] } = await r.json();
          const frames = data.frames ?? [];
          if (frames.length > 0) {
            if (!cancelled) setRadarFrames(frames);
            return true;
          }
        } catch {
          /* try next url */
        }
      }
      return false;
    }

    void (async () => {
      const practice = process.env.NEXT_PUBLIC_RADAR_PRACTICE === '1';
      if (practice) {
        const ok = await tryLoadPracticeSnapshot();
        if (ok) {
          /* Frozen ~1.5 h snapshot — do not poll live API (would replace with “maybe no rain”). */
          return;
        }
        if (!cancelled) {
          console.warn(
            '[radar] NEXT_PUBLIC_RADAR_PRACTICE=1 but no radar-practice.json / radar-practice.fixture.json — using live /api/radar/frames',
          );
        }
      }
      await loadLiveFrames();
      if (cancelled) return;
      pollId = window.setInterval(() => void loadLiveFrames(), radarDisplay.framesPollMs);
    })();

    return () => {
      cancelled = true;
      if (pollId !== undefined) window.clearInterval(pollId);
    };
  }, []);

  /** When zoom > 14, sync `viewZoom` if `move` lags (pinch / controls). */
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

  /** Remount Source when the active scan path changes — keeps react-map-gl and MapLibre in sync. */
  const radarSourceIdentity = activeRadarPath ?? 'empty';

  /**
   * Stable `<Layer>` — react-map-gl skips `setTiles` when multiple Source props change at once.
   */
  const radarRasterLayer = useMemo(
    () => (
      <Layer id="rainviewer-radar-layer" type="raster" paint={RADAR_OPACITY_PAINT} />
    ),
    [],
  );

  /**
   * Imperative `setTiles` + double rAF so updates apply right after the source is created.
   */
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
        /* source not mounted yet */
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

  const scaleBar = useMemo(
    () => scaleBarDimensions(centerLat, viewZoom),
    [centerLat, viewZoom],
  );

  if (!mapStyle) {
    return <div className="relative h-full w-full min-h-[200px] bg-[#d4d2ce]" aria-hidden />;
  }

  return (
    <div className="relative h-full w-full bg-[#d4d2ce]">
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        mapStyle={mapStyle}
        key={mapStyle.name ?? 'explore-basemap'}
        projection="mercator"
        maxParallelImageRequests={16}
        initialViewState={{
          longitude: startLng,
          latitude: startLat,
          zoom: startZoom,
          bearing: 0,
          pitch: 0,
        }}
        minZoom={MAP_MIN_ZOOM}
        maxZoom={MAP_MAX_ZOOM}
        renderWorldCopies={false}
        reuseMaps={false}
        style={{ width: '100%', height: '100%' }}
        attributionControl={{}}
        scrollZoom
        boxZoom
        dragRotate={false}
        touchPitch={false}
        onClick={() => onPoiSelect?.(null)}
        onMove={evt => {
          setViewZoom(evt.viewState.zoom);
          setCenterLat(evt.viewState.latitude);
        }}
        onLoad={() => {
          const map = mapRef.current?.getMap();
          if (!map) return;
          map.on('error', handleMapError);
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
            applyPreferredPlaceLabels(map);
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

        {homeLocationPin && (
          <Marker
            longitude={homeLocationPin.lng}
            latitude={homeLocationPin.lat}
            anchor="bottom"
            onClick={e => {
              e.originalEvent?.stopPropagation();
            }}
          >
            <div className="flex -translate-y-1 flex-col items-center gap-0.5">
              <button
                type="button"
                className="flex h-9 w-9 cursor-default items-center justify-center rounded-full border-2 border-violet-400/90 bg-violet-600/35 text-base shadow-lg ring-2 ring-violet-300/30"
                title={homeLocationPin.label}
                aria-label={homeLocationPin.label}
              >
                📍
              </button>
              <span className="max-w-[8rem] truncate rounded-md border border-white/15 bg-slate-950/90 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-violet-200 shadow-md">
                {homeLocationPin.label}
              </span>
            </div>
          </Marker>
        )}

        <NavigationControl position="top-right" />
      </Map>

      {/* Right column: HUD 11.5rem; Sammi wider (up to 22rem) — both flush right so edges align */}
      <div className="pointer-events-none absolute right-3 top-[4.25rem] z-[15] flex w-[min(22rem,calc(100%-1rem))] max-w-[22rem] flex-col items-end gap-1.5 sm:top-[4.5rem]">
        <div className="flex w-[11.5rem] flex-col gap-2">
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
            {MAP_MIN_ZOOM} {mapScaleContextLabel} · {MAP_MAX_ZOOM} detail
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
            Softer blend · linear · native z≤7
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

        <div className="pointer-events-auto relative z-20 w-full min-w-0 max-w-[22rem] flex flex-col gap-0">
          <button
            type="button"
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              setSammiPanelOpen(o => !o);
            }}
            onPointerDown={e => e.stopPropagation()}
            aria-expanded={sammiPanelOpen}
            title={sammiPanelOpen ? 'Sammi chat inklappen' : 'Sammi chat uitklappen'}
            className={[
              'touch-manipulation select-none flex w-full items-center justify-between gap-2 border border-white/15 bg-slate-950/90 px-2.5 text-left shadow-xl backdrop-blur-md transition-colors',
              sammiPanelOpen ? 'rounded-t-xl border-b-0 py-2' : 'rounded-xl py-2.5',
            ].join(' ')}
          >
            {sammiPanelOpen ? (
              <>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-widest text-cyan-400">Sammi</p>
                  <p className="text-[8px] font-semibold leading-tight text-slate-500">Concierge</p>
                </div>
                <span className="shrink-0 text-base leading-none text-slate-300" aria-hidden>
                  ▼
                </span>
              </>
            ) : (
              <>
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <img
                    src="/assets/sammi-avatar.png"
                    alt=""
                    width={36}
                    height={36}
                    className="h-9 w-9 shrink-0 rounded-full object-cover object-top ring-2 ring-cyan-500/35"
                  />
                  <span className="truncate text-sm font-semibold tracking-tight text-white">Ask Sammi</span>
                </div>
                <span className="shrink-0 text-base leading-none text-slate-300" aria-hidden>
                  ▶
                </span>
              </>
            )}
          </button>
          <div
            id="sammi-chat-anchor"
            className={
              sammiPanelOpen
                ? 'pointer-events-auto flex h-[min(58vh,32rem)] min-h-[16rem] w-full max-h-[calc(100dvh-7rem)] flex-col overflow-hidden overscroll-contain rounded-b-xl border border-t-0 border-white/15 bg-slate-950/90 shadow-xl [scrollbar-gutter:stable]'
                : 'pointer-events-none max-h-0 min-h-0 w-full overflow-hidden border-0 p-0 opacity-0 shadow-none'
            }
            aria-hidden={!sammiPanelOpen}
            aria-label="Sammi concierge chat"
          />
        </div>
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
            {`RainViewer ${RADAR_TILE_SIZE}px · z≤${RADAR_RASTER_MAX_ZOOM} native; latest scan only. Spire + meteoblue in the panel.`}
          </p>
        </div>
      </div>
    </div>
  );
}
