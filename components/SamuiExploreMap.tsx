'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Map, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import type { ErrorEvent, RasterLayerSpecification, StyleSpecification } from 'maplibre-gl';
import { ISLAND_POIS, type IslandPoi } from '../lib/island-pois';
import { RADAR_FRAMES_POLL_MS, RADAR_RASTER_FADE_MS } from '../lib/rainviewer-constants';
import { AIRPORT_METAR_SITES_TH_SOUTH } from '../lib/airport-metar-sites';
import { TMD_RADAR_MARKERS_SOUTH } from '../lib/tmd-radar-sites';
import { useRadarFrames } from './RadarFramesProvider';
import {
  KRABI_TROPICAL_OS_FALLBACK,
  fetchExploreBasemapStyle,
} from '../lib/krabi-vector-style';
import { applyPreferredPlaceLabels } from '../lib/maplibre-place-labels';
import { useHudThrottleMove } from '../lib/map-move-hud';
import RadarOverlay from './RadarOverlay';

/** Streets/POI detail (restaurants, etc.); RainViewer raster stays native z≤7 and overzooms above that. */
const MAP_MAX_ZOOM = 20;

/**
 * Exact Baan Mook Taley — Long Beach, Ao Nang, Krabi (national park coast).
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

/**
 * Koh Samui product tab only (`showIslandPois`): pan cannot move the viewport off the island/Gulf framing.
 * Krabi tab does not set `maxBounds` — unchanged.
 * SW / NE corners [lng, lat].
 */
const SAMUI_MAX_BOUNDS: [[number, number], [number, number]] = [
  [99.74, 9.32],
  [100.3, 9.74],
];

function clampMapZoom(map: maplibregl.Map) {
  map.setMaxZoom(MAP_MAX_ZOOM);
  const z = map.getZoom();
  if (z > MAP_MAX_ZOOM) {
    map.setZoom(MAP_MAX_ZOOM);
  }
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
  /** Villa / station pin(s) — e.g. Samui (Mayula + Ecowitt) or Krabi single home. */
  homeLocationPins?:
    | { lat: number; lng: number; label: string; area?: string; badge?: string }[]
    | null;
  /** Shown in zoom HUD, e.g. `island` vs `coast`. */
  mapScaleContextLabel?: string;
  /**
   * Optional RainViewer scrub: show this frame on the map instead of the newest past scan.
   * `null` = live (latest scan from feed).
   */
  radarScrub?: { path: string; time: number; translate?: [number, number] } | null;
  /**
   * Short tourist-friendly line: live rain on the map vs the forecast time bar
   * (`HOLIDAY_MAP_FOOTER_LINE` from `lib/holiday-now-hints.ts`).
   */
  mapFooterHolidayLine: string;
  /**
   * Pin-centered RainViewer tile as a semi-transparent screenshot; when set, the georeferenced
   * raster source is hidden to avoid double radar.
   */
  radarOverlayUrl?: string | null;
  /** Return to live tiled radar + clear scrub (hour bar “Live”). */
  onRadarOverlayClear?: () => void;
  /** Pull RainViewer frames immediately (LIVE chip). */
  onRefreshLive?: () => void;
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
  fadeTransitionMs: RADAR_RASTER_FADE_MS,
  framesPollMs: RADAR_FRAMES_POLL_MS,
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

/**
 * Finer than classic 1–2–5–10 so zooming doesn’t jump e.g. 10 → 5 → 2 km with nothing between.
 * Mantissas are chosen so labels stay readable (Mapbox-style density).
 */
const SCALE_NICE_MANTISSAS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10] as const;

/** Smallest “nice” distance ≥ distM at this decade (meters). */
function ceilNiceMeters(distM: number): number {
  const exp = Math.floor(Math.log10(distM));
  const pow10 = 10 ** exp;
  const mantissa = distM / pow10; // [1, 10)
  const pick =
    SCALE_NICE_MANTISSAS.find((m) => m >= mantissa - 1e-9) ?? 10;
  return pick * pow10;
}

function formatScaleBarLabel(niceM: number): string {
  if (niceM >= 1000) {
    const km = niceM / 1000;
    if (Math.abs(km - Math.round(km)) < 1e-4) return `${Math.round(km)} km`;
    return `${km.toFixed(1)} km`;
  }
  return `${Math.round(niceM)} m`;
}

/** Nice round distance (m) and bar width (px) for a ~72px target bar */
function scaleBarDimensions(lat: number, zoom: number): { label: string; widthPx: number } {
  const mpp = metersPerPixel(lat, zoom);
  const targetPx = 72;
  const distM = mpp * targetPx;
  if (!Number.isFinite(distM) || distM <= 0 || !Number.isFinite(mpp)) {
    return { label: '—', widthPx: 0 };
  }
  const niceM = ceilNiceMeters(distM);
  const widthPx = Math.min(120, Math.max(24, niceM / mpp));
  return { label: formatScaleBarLabel(niceM), widthPx };
}

/** Tropical OSM basemap + RainViewer radar; Koh Samui POIs or `homeLocationPins` (villa + station). */
export default function SamuiExploreMap({
  flyToRequest = null,
  onPoiSelect,
  initialLongitude,
  initialLatitude,
  initialZoom,
  showIslandPois = true,
  homeLocationPins = null,
  mapScaleContextLabel = 'island',
  radarScrub = null,
  mapFooterHolidayLine,
  radarOverlayUrl = null,
  onRadarOverlayClear,
  onRefreshLive,
}: SamuiExploreMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const startLng = initialLongitude ?? INITIAL_LNG;
  const startLat = initialLatitude ?? INITIAL_LAT;
  const startZoom = initialZoom ?? INITIAL_MAP_ZOOM;
  /** From {@link RadarFramesProvider} — fetched at app root so radar metadata logs on every route. */
  const radarFrames = useRadarFrames();
  const [liveClockKey, setLiveClockKey] = useState(0);
  const [liveAgeKey, setLiveAgeKey] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setLiveClockKey((x) => x + 1), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setLiveAgeKey((x) => x + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const latestRadarScanSec = useMemo(() => {
    if (radarFrames.length === 0) return null;
    return Math.max(...radarFrames.map((f) => f.time));
  }, [radarFrames]);

  const liveClockHm = useMemo(() => {
    void liveClockKey;
    return new Date().toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }, [liveClockKey]);

  const liveFeedSubline = useMemo(() => {
    void liveAgeKey;
    if (latestRadarScanSec == null) return 'Waiting for radar frames…';
    const scanHm = new Date(latestRadarScanSec * 1000).toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const ageMin = Math.max(
      0,
      Math.round((Date.now() / 1000 - latestRadarScanSec) / 60),
    );
    return `Last scan ${scanHm} ICT · ${ageMin}m ago`;
  }, [latestRadarScanSec, liveAgeKey]);
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

  /** After one MapTiler vector tile network failure, swap to OSM raster so the map stays usable. */
  const mapTilerFallbackDoneRef = useRef(false);
  const setMapStyleRef = useRef(setMapStyle);
  setMapStyleRef.current = setMapStyle;

  const applyMoveHud = useCallback((zoom: number, latitude: number) => {
    setViewZoom(zoom);
    setCenterLat(latitude);
  }, []);

  const onMoveHud = useHudThrottleMove(applyMoveHud);

  const handleMapError = useCallback((e: ErrorEvent) => {
    const msg = e.error?.message ?? String(e.error ?? 'MapLibre error');
    const ext = e as ErrorEvent & {
      sourceId?: string;
      tile?: { tileID?: { z: number; x: number; y: number } };
    };
    const sid = ext.sourceId ?? '';

    const isMapTilerVector =
      sid === 'maptiler_planet' ||
      sid.includes('maptiler') ||
      /maptiler/i.test(msg);

    if (
      isMapTilerVector &&
      /failed to fetch|network|load failed|ajaxerror/i.test(msg) &&
      !mapTilerFallbackDoneRef.current
    ) {
      mapTilerFallbackDoneRef.current = true;
      console.info(
        '[SamuiExploreMap] MapTiler tiles failed to load (key, referrer, or network). Using OSM raster fallback.',
      );
      setMapStyleRef.current(KRABI_TROPICAL_OS_FALLBACK);
      return;
    }

    if (mapTilerFallbackDoneRef.current && isMapTilerVector) {
      return;
    }

    if (
      ext.sourceId === 'rainviewer-radar' &&
      (/could not be decoded/i.test(msg) || /InvalidStateError/i.test(msg))
    ) {
      return;
    }
    console.warn('[SamuiExploreMap]', msg, {
      sourceId: ext.sourceId,
      tile: ext.tile?.tileID ?? ext.tile,
    }, e);
  }, []);

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
      zoom: Math.min(flyToRequest.zoom ?? 17.5, MAP_MAX_ZOOM),
      duration: 2200,
      essential: true,
    });
  }, [flyToRequest]);

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

  const activeRadarPath = radarScrub?.path ?? latestRadarFrame?.path ?? null;

  /** Time of the scan currently shown on the map (scrub or live). */
  const activeScanClockLabel = useMemo(() => {
    const t = radarScrub?.time ?? latestRadarFrame?.time;
    if (!t) return null;
    return new Date(t * 1000).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [radarScrub?.time, latestRadarFrame?.time]);

  const radarTiles = useMemo(
    () => (activeRadarPath ? [buildRadarTileUrl(activeRadarPath)] : []),
    [activeRadarPath],
  );

  /** MapLibre raster layers do not support `raster-translate` (unlike some Mapbox builds). */
  const radarLayerPaint = useMemo((): RasterLayerSpecification['paint'] => {
    return { ...RADAR_OPACITY_PAINT };
  }, []);

  const showNativeRadarLayer = !radarOverlayUrl;

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
        map.triggerRepaint();
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
        maxBounds={showIslandPois ? SAMUI_MAX_BOUNDS : undefined}
        scrollZoom={showIslandPois ? { around: 'center' } : true}
        touchZoomRotate={showIslandPois ? { around: 'center' } : true}
        boxZoom
        dragRotate={false}
        touchPitch={false}
        onClick={() => onPoiSelect?.(null)}
        onMove={onMoveHud}
        onLoad={() => {
          const map = mapRef.current?.getMap();
          if (!map) return;
          map.on('error', handleMapError);
          clampMapZoom(map);
          if (showIslandPois) {
            map.setMaxBounds(SAMUI_MAX_BOUNDS);
            map.scrollZoom.enable({ around: 'center' });
            map.touchZoomRotate.enable({ around: 'center' });
          }
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
          if (!map) return;
          if (map.getZoom() > MAP_MAX_ZOOM) {
            map.setZoom(MAP_MAX_ZOOM);
          }
          setViewZoom(map.getZoom());
          setCenterLat(map.getCenter().lat);
        }}
      >
        {baseMapReady && radarTiles.length > 0 && showNativeRadarLayer && (
          <Source
            key="rainviewer-raster-stable"
            id="rainviewer-radar"
            type="raster"
            tiles={radarTiles}
            tileSize={RADAR_TILE_SIZE}
            minzoom={0}
            maxzoom={RADAR_RASTER_MAX_ZOOM}
            scheme="xyz"
          >
            <Layer id="rainviewer-radar-layer" type="raster" paint={radarLayerPaint} />
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

        {homeLocationPins?.map(pin => {
          const tip = [pin.badge, pin.label, pin.area].filter(Boolean).join(' · ');
          return (
            <Marker
              key={`${pin.label}-${pin.lat}-${pin.lng}`}
              longitude={pin.lng}
              latitude={pin.lat}
              anchor="bottom"
              onClick={e => {
                e.originalEvent?.stopPropagation();
              }}
            >
              <div
                className="group relative flex cursor-default flex-col items-center pointer-events-auto"
                role="group"
                aria-label={tip}
              >
                <div
                  className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 max-w-[11rem] -translate-x-1/2 rounded-md border border-white/20 bg-slate-950/95 px-2 py-1 text-center opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
                  aria-hidden
                >
                  {pin.badge ? (
                    <p className="mb-0.5 text-[7px] font-bold uppercase tracking-widest text-emerald-300/95">
                      {pin.badge}
                    </p>
                  ) : null}
                  <p className="text-[9px] font-semibold leading-snug text-white">{pin.label}</p>
                  {pin.area ? (
                    <p className="mt-0.5 text-[8px] leading-snug text-violet-200/90">{pin.area}</p>
                  ) : null}
                </div>
                <span
                  className="pointer-events-none select-none text-[1.65rem] leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9),0_0_4px_rgba(0,0,0,0.5)]"
                  aria-hidden
                >
                  📍
                </span>
              </div>
            </Marker>
          );
        })}

        {TMD_RADAR_MARKERS_SOUTH.map(site => (
          <Marker
            key={site.id}
            longitude={site.lon}
            latitude={site.lat}
            anchor="center"
            onClick={e => {
              e.originalEvent?.stopPropagation();
            }}
          >
            <div
              className="group relative flex cursor-default items-center justify-center pointer-events-auto"
              role="img"
              aria-label={`${site.code} ${site.label} · WMO ${site.wmo} · RainViewer ${site.rainViewerId}`}
            >
              <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-max max-w-[12rem] -translate-x-1/2 rounded-md border border-amber-400/35 bg-slate-950/95 px-2 py-1.5 text-center opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                <p className="text-[8px] font-bold uppercase leading-snug text-amber-200/95">{site.label}</p>
                <p className="mt-0.5 font-mono text-[9px] font-bold text-amber-100/90">{site.code}</p>
                <p className="mt-0.5 font-mono text-[8px] font-semibold text-cyan-200/90">
                  RainViewer ID: {site.rainViewerId}
                </p>
                <p className="mt-0.5 text-[7px] leading-snug text-slate-400">
                  TMD Doppler · merged into RainViewer composite tiles (not a separate layer)
                </p>
              </div>
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-amber-400/75 bg-amber-950/90 text-[0.95rem] shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
                title={`${site.label} · RainViewer ${site.rainViewerId}`}
              >
                📡
              </div>
            </div>
          </Marker>
        ))}

        {AIRPORT_METAR_SITES_TH_SOUTH.map(ap => (
          <Marker
            key={ap.id}
            longitude={ap.lon}
            latitude={ap.lat}
            anchor="center"
            onClick={e => {
              e.originalEvent?.stopPropagation();
            }}
          >
            <div
              className="group relative flex cursor-default items-center justify-center pointer-events-auto"
              role="img"
              aria-label={`${ap.iata} ${ap.label} · ICAO ${ap.icao} · METAR / TAF`}
            >
              <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-max max-w-[12rem] -translate-x-1/2 rounded-md border border-emerald-400/35 bg-slate-950/95 px-2 py-1.5 text-center opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                <p className="text-[8px] font-bold uppercase leading-snug text-emerald-200/95">{ap.label}</p>
                <p className="mt-0.5 font-mono text-[9px] font-bold text-emerald-100/90">
                  {ap.iata} · {ap.icao}
                </p>
                <p className="mt-0.5 text-[7px] leading-snug text-slate-400">
                  Airport METAR / TAF (same family as dashboard ✈️ VTSM card on Samui)
                </p>
              </div>
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-emerald-400/75 bg-emerald-950/90 text-[0.95rem] shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
                title={`${ap.label} · ${ap.iata} · ${ap.icao}`}
              >
                ✈️
              </div>
            </div>
          </Marker>
        ))}

        <NavigationControl position="top-right" />
      </Map>

      {radarOverlayUrl ? (
        <RadarOverlay
          frameUrl={radarOverlayUrl}
          label="Live radar"
          onDismiss={onRadarOverlayClear}
          dismissLabel="Live"
        />
      ) : (
        <div className="pointer-events-auto absolute right-3 top-[3.25rem] z-[16] flex flex-col items-end gap-0.5 sm:top-[3.5rem]">
          <button
            type="button"
            onClick={() => onRefreshLive?.()}
            className="flex flex-wrap items-baseline gap-x-1.5 rounded-md border border-emerald-500/40 bg-emerald-950/80 px-2 py-0.5 shadow-lg backdrop-blur-sm transition-colors hover:bg-emerald-900/75"
            title="Refresh radar now"
          >
            <span className="text-[8px] font-black uppercase tracking-widest text-emerald-200">
              LIVE
            </span>
            <span className="font-mono text-[9px] font-bold tabular-nums tracking-normal text-emerald-50/95">
              {liveClockHm} ICT
            </span>
          </button>
          <p className="max-w-[11rem] text-right text-[6.5px] font-medium leading-tight text-emerald-200/55">
            {liveFeedSubline}
          </p>
        </div>
      )}

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

        <div className="pointer-events-none rounded-xl border border-white/15 bg-slate-950/90 px-3 py-2.5 shadow-xl backdrop-blur-md">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Legend</p>
          <ul className="mt-1.5 space-y-1.5 text-[8px] leading-snug text-slate-400">
            <li>
              <span className="font-semibold text-slate-300">Basemap</span>
              {' — '}
              MapTiler Streets&nbsp;v2 · roads, coast, place labels (OSM).
            </li>
            <li>
              <span className="font-semibold text-slate-300">Radar</span>
              {' — '}
              TMD nationwide mosaic (RainViewer): Phuket, Surat Thani, Sathing Phra &amp; others · green → red = echo
              intensity.
            </li>
            <li>
              <span className="font-semibold text-amber-300/90">📡 TMD Doppler</span>
              {' — '}
              RainViewer table IDs{' '}
              <span className="font-mono text-cyan-200/90">PHU</span> ·{' '}
              <span className="font-mono text-cyan-200/90">SRT</span> ·{' '}
              <span className="font-mono text-cyan-200/90">SKA</span> · merged mosaic (not separate layers).
            </li>
            <li>
              <span className="font-semibold text-emerald-300/90">✈️ USM · KBV · HKT</span>
              {' — '}
              International airport METAR sites (ICAO{' '}
              <span className="font-mono text-emerald-200/85">VTSM</span> ·{' '}
              <span className="font-mono text-emerald-200/85">VTSG</span> ·{' '}
              <span className="font-mono text-emerald-200/85">VTSP</span>
              ) — same idea as the Samui ✈️ VTSM panel; not a second radar layer.
            </li>
            {showIslandPois && (
              <li>
                <span className="font-semibold text-slate-300">Curated pins</span>
                {' — '}
                <span title="Sammi picks">🍽</span> dining · <span title="Beach club">🏖</span> beach club (tap for intel).
              </li>
            )}
            {homeLocationPins?.map(pin => (
              <li key={`leg-${pin.label}-${pin.lat}`}>
                {pin.badge ? (
                  <>
                    <span className="font-semibold text-emerald-300/90">{pin.badge}</span>
                    {' — '}
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-slate-300">Home</span>
                    {' — '}
                  </>
                )}
                📍 {pin.label}
                {pin.area ? ` · ${pin.area}` : ''}.
              </li>
            ))}
          </ul>
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
            title={sammiPanelOpen ? 'Hide SAMMI Weather Expert' : 'Open SAMMI Weather Expert'}
            className={[
              'touch-manipulation select-none flex w-full items-center justify-between gap-2 border border-white/15 bg-slate-950/90 px-2.5 text-left shadow-xl backdrop-blur-md transition-colors',
              sammiPanelOpen ? 'rounded-t-xl border-b-0 py-2' : 'rounded-xl py-2.5',
            ].join(' ')}
          >
            {sammiPanelOpen ? (
              <>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.12em] text-cyan-300">SAMMI Weather Expert</p>
                  <p className="text-[8px] font-semibold leading-tight text-slate-500">Tap to hide</p>
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
                  <div className="min-w-0 text-left">
                    <p className="truncate text-[11px] font-black uppercase tracking-wide text-white">SAMMI Weather Expert</p>
                    <p className="truncate text-[8px] font-medium text-slate-500">Live · chat below</p>
                  </div>
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
            aria-label="SAMMI Weather Expert"
          />
        </div>
      </div>

      {/* RainViewer — bottom-left */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="pointer-events-auto absolute bottom-24 left-3 flex max-w-[min(100%-1.5rem,22rem)] flex-col items-start gap-1 sm:bottom-28">
          <div
            className="rounded-full border border-cyan-500/35 bg-cyan-500/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-cyan-200 shadow-lg backdrop-blur-md"
            title={
              radarScrub
                ? `Scan ${activeScanClockLabel ?? '—'} (scrub). Tap “Live” in the hour bar for the newest sweep.`
                : 'Latest RainViewer scan only — no animation loop. Map crossfades when a newer scan appears after refresh.'
            }
          >
            🌧 Radar · {radarScrub ? 'scrub' : 'live'}
            {activeScanClockLabel ? ` · ${activeScanClockLabel}` : ''} · refresh{' '}
            {Math.round(radarDisplay.framesPollMs / 60000)}m · fade {radarDisplay.fadeTransitionMs}ms
          </div>
          <p className="rounded-lg border border-white/10 bg-slate-950/85 px-2 py-1 text-[8px] leading-snug text-slate-500 backdrop-blur-sm">
            {mapFooterHolidayLine}
          </p>
        </div>
      </div>
    </div>
  );
}
