'use client';

import dynamic from 'next/dynamic';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SamuiWeatherForecastRow } from '../lib/spire';
import type { TideTrend } from '../lib/tides';
import {
  getNextTideExtremum,
  getTideDataSource,
  getTideHeightAtNow,
  getTideTrend,
} from '../lib/tides';
import TideCard from './TideCard';
import ShowerNowcastCard from './ShowerNowcastCard';
import AirQualityCard from './AirQualityCard';
import UVIndexCard from './UVIndexCard';
import VacationDashboard from './VacationDashboard';
import SammiConcierge from './SammiConcierge';
import WebcamGrid from './WebcamGrid';
import MetarCard from './MetarCard';
import EcowittPlaceholder from './EcowittPlaceholder';
import StormAlertBanner from './StormAlertBanner';
import RadarHourlyTimeline from './RadarHourlyTimeline';
import { getPoiById, type IslandPoi } from '../lib/island-pois';
import PoiIntelligenceCard from './PoiIntelligenceCard';
import {
  DASHBOARD_REGION_TAB_ORDER,
  DEFAULT_DASHBOARD_REGION_ID,
  type DashboardRegionId,
  getDashboardRegion,
} from '../lib/dashboard-regions';
import { HOLIDAY_MAP_FOOTER_LINE } from '../lib/holiday-now-hints';
import type { MetarApiResponse } from '../app/api/metar/route';
import { dominantCoverFromMetarClouds, type MetarDominantCover } from '../lib/sky-display';
import { sampleRadarEchoAtLocation } from '../lib/rainviewer-tile-sample';
import { rainPossibleInNext6Hours } from '../lib/rain-next-6h';
import { useRadarFeed } from './RadarFramesProvider';
import { mergeSamuiHourlyIntoRows } from '../lib/merge-sammi-forecast';
import type { SammiDailyForecastViewRow, SammiForecastViewRow } from '../lib/sammi-views';
import {
  blendReferenceNowcastIntoFirstRow,
  type ReferenceNowcastSnapshot,
} from '../lib/forecast-reference';

const SamuiExploreMap = dynamic(() => import('./SamuiExploreMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#d4d2ce] text-[10px] text-slate-500">
      Loading map…
    </div>
  ),
});

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Renders Sammi into `#sammi-chat-anchor` below the map radar stack (see SamuiExploreMap). */
function SammiChatPortal({
  forecastRows,
  onMapFlyTo,
  conflictRegion,
  mapRegionKey,
}: {
  forecastRows: SamuiWeatherForecastRow[];
  onMapFlyTo?: (locationId: string) => void;
  conflictRegion: 'samui' | 'krabi';
  /** SamuiExploreMap remounts per region — re-attach portal to the new `#sammi-chat-anchor`. */
  mapRegionKey: string;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  /**
   * Poll until `#sammi-chat-anchor` exists (map style loads async). Re-attach only when the map
   * remounts (`mapRegionKey`). Do **not** depend on `forecastRows` — every Spire refresh would
   * `setHost(null)`, remount the portal, and break clicks / inklap state.
   */
  useEffect(() => {
    setHost(null);
    let cancelled = false;
    const tryAttach = (): boolean => {
      const el = document.getElementById('sammi-chat-anchor');
      if (el) {
        setHost(el);
        return true;
      }
      return false;
    };
    if (tryAttach()) return;
    const id = window.setInterval(() => {
      if (cancelled) return;
      if (tryAttach()) window.clearInterval(id);
    }, 50);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [mapRegionKey]);

  if (!host) return null;
  return createPortal(
    <div className="pointer-events-auto flex h-full min-h-[18rem] flex-col">
      <SammiConcierge
        className="!mb-0 h-full min-h-0"
        forecastRows={forecastRows}
        onMapFlyTo={onMapFlyTo}
        conflictRegion={conflictRegion}
      />
    </div>,
    host,
  );
}

/** Client cache so refresh / deploy does not flash empty state while Spire + WAQI + UV load */
const FORECAST_CACHE_MAX_MS = 50 * 60 * 1000;

function forecastCacheKey(regionId: DashboardRegionId): string {
  return `samui-spire-forecast-v2-${regionId}`;
}

function forecastCacheTsKey(regionId: DashboardRegionId): string {
  return `samui-spire-forecast-v2-${regionId}-ts`;
}

type ReferenceGridClientState =
  | { status: 'loading' }
  | { status: 'disabled' }
  | { status: 'error' }
  | { status: 'ok'; snap: ReferenceNowcastSnapshot };

export default function MapViewer() {
  const [dashboardRegionId, setDashboardRegionId] = useState<DashboardRegionId>(
    DEFAULT_DASHBOARD_REGION_ID,
  );
  const region = getDashboardRegion(dashboardRegionId);

  const [forecastRows, setForecastRows] = useState<SamuiWeatherForecastRow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tideTrend, setTideTrend]         = useState<TideTrend>('unknown');
  const [tideHeightM, setTideHeightM]     = useState<number | null>(null);
  const [tideRaw, setTideRaw]             = useState<unknown>(null);
  const [forecastStatus, setForecastStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [forecastError, setForecastError]   = useState<string | null>(null);
  /** Nearest-hour local grid for row-0 blend only; hourly strip + DB Sammi = Spire. */
  const [mbState, setMbState] = useState<ReferenceGridClientState>({ status: 'loading' });
  /** Server-side `sammi_forecast` / `sammi_daily_forecast` (kans_*, advice, reliability). */
  const [sammiHourlyRows, setSammiHourlyRows] = useState<SammiForecastViewRow[]>([]);
  const [sammiDailyByIsoDay, setSammiDailyByIsoDay] = useState<Record<
    string,
    SammiDailyForecastViewRow
  > | null>(null);
  /** Global RainViewer feed (root provider) — independent of map mount. */
  const radarFeed = useRadarFeed();
  const [radarEcho, setRadarEcho] = useState<'unknown' | 'none' | 'precip'>('unknown');
  /** Region airport METAR dominant layer — softens Spire cloud % when sky is clear/few. */
  const [metarSkyCover, setMetarSkyCover] = useState<MetarDominantCover>(null);
  /** Storm strip is `fixed` + high z-index — pad the drawer so region tabs stay reachable. */
  const [stormBannerActive, setStormBannerActive] = useState(false);
  /** RainViewer frame chosen from hourly strip — `null` = newest scan (live). */
  const [radarScrubFrame, setRadarScrubFrame] = useState<{
    path: string;
    time: number;
    targetUtcSec?: number;
    translate?: [number, number];
    hourKey?: string;
  } | null>(null);
  /** Pin-centered tile snapshot over the map (hour bar / Play); `null` = tiled live radar. */
  const [radarOverlayUrl, setRadarOverlayUrl] = useState<string | null>(null);
  const handleRadarOverlayClear = useCallback(() => {
    setRadarOverlayUrl(null);
    setRadarScrubFrame(null);
  }, []);

  // Dashboard collapse — closed on mobile by default, open on desktop
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  useEffect(() => {
    if (window.innerWidth >= 640) setIsDashboardOpen(true);
  }, []);

  useEffect(() => {
    setRadarScrubFrame(null);
    setRadarOverlayUrl(null);
  }, [dashboardRegionId]);

  // Section toggles
  const [showTide,  setShowTide]  = useState(true);
  const [showAirUV, setShowAirUV] = useState(false);
  const [showCams,  setShowCams]  = useState(false);
  const [showMetar, setShowMetar] = useState(false);

  /** Sammi / POI → Mapbox flyTo */
  const [flyToRequest, setFlyToRequest] = useState<{
    key: number;
    lng: number;
    lat: number;
    zoom?: number;
  } | null>(null);

  /** Map POI card — rendered above the drawer so it is not covered */
  const [selectedMapPoi, setSelectedMapPoi] = useState<IslandPoi | null>(null);

  const drawerBodyScrollRef = useRef<HTMLDivElement>(null);
  const forecastRowsRef = useRef<SamuiWeatherForecastRow[]>([]);
  forecastRowsRef.current = forecastRows;

  /**
   * Restore cached forecast for this region, or clear so we do not briefly show the other
   * region’s Spire rows after a tab switch.
   */
  useLayoutEffect(() => {
    try {
      const ts = Number(sessionStorage.getItem(forecastCacheTsKey(dashboardRegionId)));
      const raw = sessionStorage.getItem(forecastCacheKey(dashboardRegionId));
      if (!raw || !Number.isFinite(ts) || Date.now() - ts > FORECAST_CACHE_MAX_MS) {
        setForecastRows([]);
        setForecastStatus('loading');
        setForecastError(null);
        setSelectedIndex(0);
        return;
      }
      const parsed = JSON.parse(raw) as SamuiWeatherForecastRow[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setForecastRows([]);
        setForecastStatus('loading');
        setForecastError(null);
        setSelectedIndex(0);
        return;
      }
      setForecastRows(parsed);
      setForecastStatus('ok');
      setForecastError(null);
      setSelectedIndex(0);
    } catch {
      setForecastRows([]);
      setForecastStatus('loading');
      setForecastError(null);
      setSelectedIndex(0);
    }
  }, [dashboardRegionId]);

  /** Keep drawer scrolled to weather (top) on open / when forecast loads — chat input must not use mount focus (scrolls into view). */
  useEffect(() => {
    if (!isDashboardOpen) return;
    const el = drawerBodyScrollRef.current;
    if (!el) return;
    const scrollTop = () => {
      el.scrollTop = 0;
    };
    scrollTop();
    requestAnimationFrame(scrollTop);
    const t1 = window.setTimeout(scrollTop, 320);
    const t2 = window.setTimeout(scrollTop, 500);
    const t3 = window.setTimeout(scrollTop, 650);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [isDashboardOpen, forecastStatus]);

  useEffect(() => {
    setSelectedMapPoi(null);
  }, [dashboardRegionId]);

  // ── SPIRE forecast (revalidate in background; keep cache on transient failure) ─
  useEffect(() => {
    const hadRows = forecastRowsRef.current.length > 0;
    if (!hadRows) {
      setForecastError(null);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    const q = `?lat=${encodeURIComponent(String(region.lat))}&lon=${encodeURIComponent(String(region.lon))}`;
    const forecastUrl = `/api/spire/forecast${q}`;
    // #region agent log
    fetch('http://127.0.0.1:7488/ingest/700ecb43-33c3-46ad-a0f9-880b489bb2e9', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'e62a63',
      },
      body: JSON.stringify({
        sessionId: 'e62a63',
        hypothesisId: 'H1',
        location: 'MapViewer.tsx:forecast-fetch-start',
        message: 'client forecast fetch start',
        data: { dashboardRegionId, forecastUrl },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    fetch(forecastUrl, {
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timer);
        // #region agent log
        fetch('http://127.0.0.1:7488/ingest/700ecb43-33c3-46ad-a0f9-880b489bb2e9', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': 'e62a63',
          },
          body: JSON.stringify({
            sessionId: 'e62a63',
            hypothesisId: 'H2',
            location: 'MapViewer.tsx:forecast-fetch-response',
            message: 'client forecast response headers',
            data: { ok: res.ok, status: res.status, dashboardRegionId },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        const data: unknown = await res.json();
        if (!res.ok) {
          const err =
            typeof data === 'object' && data !== null && 'error' in data &&
            typeof (data as { error: unknown }).error === 'string'
              ? (data as { error: string }).error
              : `HTTP ${res.status}`;
          // #region agent log
          fetch('http://127.0.0.1:7488/ingest/700ecb43-33c3-46ad-a0f9-880b489bb2e9', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Debug-Session-Id': 'e62a63',
            },
            body: JSON.stringify({
              sessionId: 'e62a63',
              hypothesisId: 'H2',
              location: 'MapViewer.tsx:forecast-fetch-not-ok',
              message: 'API returned error body',
              data: { status: res.status, err },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          if (forecastRowsRef.current.length === 0) {
            setForecastRows([]);
            setForecastError(err);
            setForecastStatus('error');
          }
          return;
        }
        if (!Array.isArray(data) || data.length === 0) {
          if (forecastRowsRef.current.length === 0) {
            setForecastRows([]);
            setForecastError('No forecast data from API');
            setForecastStatus('error');
          }
          return;
        }
        const rows = data as SamuiWeatherForecastRow[];
        setForecastRows(rows);
        setSelectedIndex(0);
        setForecastStatus('ok');
        setForecastError(null);
        try {
          sessionStorage.setItem(forecastCacheKey(dashboardRegionId), JSON.stringify(rows));
          sessionStorage.setItem(forecastCacheTsKey(dashboardRegionId), String(Date.now()));
        } catch {
          /* quota */
        }
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        // #region agent log
        const en = err instanceof Error ? err.name : 'non-Error';
        const em = err instanceof Error ? err.message : String(err);
        fetch('http://127.0.0.1:7488/ingest/700ecb43-33c3-46ad-a0f9-880b489bb2e9', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': 'e62a63',
          },
          body: JSON.stringify({
            sessionId: 'e62a63',
            hypothesisId: 'H1',
            location: 'MapViewer.tsx:forecast-fetch-catch',
            message: 'client forecast fetch rejected',
            data: { errName: en, errMessage: em, dashboardRegionId },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        if (forecastRowsRef.current.length === 0) {
          setForecastRows([]);
          setForecastError(err instanceof Error ? err.message : 'Network error');
          setForecastStatus('error');
        }
      });

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [dashboardRegionId, region.lat, region.lon]);

  /** Supabase Sammi views: parallel to Spire only when `region.weatherLocationId` is set. */
  useEffect(() => {
    if (!region.weatherLocationId) {
      setSammiHourlyRows([]);
      setSammiDailyByIsoDay(null);
      return;
    }
    const loc = encodeURIComponent(region.weatherLocationId);
    const q = `?location_id=${loc}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    const run = async () => {
      try {
        const [hRes, dRes] = await Promise.all([
          fetch(`/api/weather/sammi-forecast${q}`, { signal: ac.signal, cache: 'no-store' }),
          fetch(`/api/weather/sammi-daily${q}`, { signal: ac.signal, cache: 'no-store' }),
        ]);
        if (hRes.ok) {
          const hJson = (await hRes.json()) as { rows?: SammiForecastViewRow[] | null };
          setSammiHourlyRows(Array.isArray(hJson.rows) ? hJson.rows : []);
        } else {
          setSammiHourlyRows([]);
        }
        if (dRes.ok) {
          const dJson = (await dRes.json()) as { rows?: SammiDailyForecastViewRow[] | null };
          const by: Record<string, SammiDailyForecastViewRow> = {};
          for (const r of Array.isArray(dJson.rows) ? dJson.rows : []) {
            if (!r) continue;
            const raw = (r as { forecast_date?: string }).forecast_date;
            const k = typeof raw === 'string' ? raw.slice(0, 10) : '';
            if (k) by[k] = r;
          }
          setSammiDailyByIsoDay(Object.keys(by).length > 0 ? by : null);
        } else {
          setSammiDailyByIsoDay(null);
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        setSammiHourlyRows([]);
        setSammiDailyByIsoDay(null);
      } finally {
        clearTimeout(timer);
      }
    };
    void run();
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [region.weatherLocationId, dashboardRegionId]);

  useEffect(() => {
    if (forecastRows.length === 0) return;
    setSelectedIndex(i => Math.min(i, forecastRows.length - 1));
  }, [forecastRows.length]);

  // ── Tides ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    /** Spire + Open-Meteo fallback can exceed 15s on slow links; never treat error JSON as tide data. */
    const timer = setTimeout(() => controller.abort(), 28000);

    const tq = `?lat=${encodeURIComponent(String(region.lat))}&lon=${encodeURIComponent(String(region.lon))}`;
    fetch(`/api/tides${tq}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        clearTimeout(timer);
        const raw: unknown = await res.json();
        if (!res.ok) {
          setTideRaw(null);
          setTideTrend('unknown');
          setTideHeightM(null);
          return;
        }
        if (
          raw === null ||
          typeof raw !== 'object' ||
          !Array.isArray((raw as { data?: unknown }).data)
        ) {
          setTideRaw(null);
          setTideTrend('unknown');
          setTideHeightM(null);
          return;
        }
        setTideRaw(raw);
        setTideTrend(getTideTrend(raw));
        setTideHeightM(getTideHeightAtNow(raw));
      })
      .catch(() => {
        clearTimeout(timer);
        setTideRaw(null);
        setTideTrend('unknown');
        setTideHeightM(null);
      });

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [region.lat, region.lon]);

  // ── METAR sky (VTSM / VTSG) — blend with Spire cloud % on the snapshot card ─
  useEffect(() => {
    const icao = dashboardRegionId === 'krabi_baan_mook_taley' ? 'VTSG' : 'VTSM';
    fetch('/api/metar')
      .then(r => r.json())
      .then((d: MetarApiResponse) => {
        const m = d.stations?.[icao]?.metar;
        setMetarSkyCover(dominantCoverFromMetarClouds(m?.clouds));
      })
      .catch(() => setMetarSkyCover(null));
  }, [dashboardRegionId]);

  // ── Local 1h grid (private route) — blend into row 0; strip stays Spire-led ─
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      fetch(
        `/api/meteoblue/point?lat=${encodeURIComponent(String(region.lat))}&lon=${encodeURIComponent(String(region.lon))}`,
        { cache: 'no-store' },
      )
        .then((r) => r.json())
        .then(
          (d: {
            ok?: boolean;
            enabled?: boolean;
            snapshot?: {
              tempC: number | null;
              windSpeedMs: number;
              windDirDeg: number;
              precipMm: number;
            };
          }) => {
            if (cancelled) return;
            if (d.enabled === false) {
              setMbState({ status: 'disabled' });
              return;
            }
            if (!d.ok || !d.snapshot) {
              setMbState({ status: 'error' });
              return;
            }
            const s = d.snapshot;
            setMbState({
              status: 'ok',
              snap: {
                tempC: typeof s.tempC === 'number' ? s.tempC : null,
                windSpeedMs: Number(s.windSpeedMs) || 0,
                windDirDeg: Math.round(Number(s.windDirDeg) || 0),
                precipMm: typeof s.precipMm === 'number' ? s.precipMm : 0,
              },
            });
          },
        )
        .catch(() => {
          if (!cancelled) setMbState({ status: 'error' });
        });
    };
    setMbState({ status: 'loading' });
    run();
    const id = window.setInterval(run, 3 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [region.lat, region.lon]);

  // ── RainViewer tile at pin: echo vs dry model row 0 (from global feed, not from map sampling) ─
  useEffect(() => {
    const path = radarFeed.latestFrame?.path;
    if (!path) {
      if (radarFeed.status === 'loading') setRadarEcho('unknown');
      else setRadarEcho('none');
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    void sampleRadarEchoAtLocation(region.lat, region.lon, path, ac.signal).then((r) => {
      if (!cancelled) setRadarEcho(r);
    });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [radarFeed.latestFrame, radarFeed.status, region.lat, region.lon]);

  const spireWithSammi = useMemo(
    () => mergeSamuiHourlyIntoRows(forecastRows, sammiHourlyRows),
    [forecastRows, sammiHourlyRows],
  );

  const displayForecastRows = useMemo(() => {
    const snap = mbState.status === 'ok' ? mbState.snap : null;
    return blendReferenceNowcastIntoFirstRow(spireWithSammi, snap);
  }, [spireWithSammi, mbState]);

  const rainPossibleNext6h = useMemo(() => {
    if (displayForecastRows.length === 0) return radarEcho === 'precip';
    return rainPossibleInNext6Hours(displayForecastRows, radarEcho);
  }, [displayForecastRows, radarEcho]);

  const radarLeadsOverDryModels = useMemo(() => {
    if (radarEcho !== 'precip' || selectedIndex !== 0 || forecastRows.length === 0) return false;
    const spire0 = forecastRows[0]!;
    if (spire0.precipRate >= 0.1) return false;
    const mbDry =
      mbState.status !== 'ok' || (mbState.status === 'ok' && mbState.snap.precipMm < 0.05);
    return mbDry;
  }, [radarEcho, selectedIndex, forecastRows, mbState]);

  const weather = displayForecastRows[selectedIndex] ?? null;

  const handleMapFlyTo = (locationId: string) => {
    const p = getPoiById(locationId);
    if (!p) return;
    setFlyToRequest({
      key: Date.now(),
      lng: p.lon,
      lat: p.lat,
      zoom: 18.2,
    });
  };

  const isFuture = selectedIndex > 0 && displayForecastRows.length > 0;
  const selectedTimeStr = isFuture && weather
    ? new Date(weather.time).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'Asia/Bangkok',
      })
    : null;

  // ── Status dot helper (🌧️ = globale RainViewer feed uit RadarFramesProvider) ─
  const sourceStatus = useMemo(() => {
    const radarLoading = radarFeed.status === 'loading';
    const radarLive = radarFeed.status === 'ready' && radarFeed.frames.length > 0;
    const fo = forecastStatus === 'ok';
    return fo
      ? [
          { icon: '🛰️', ok: true },
          { icon: '🌧️', ok: radarLive, offline: radarLoading },
          { icon: '✈️', ok: true },
          { icon: '📍', ok: false, offline: true },
        ]
      : [
          { icon: '🛰️', ok: false },
          { icon: '🌧️', ok: radarLive, offline: radarLoading },
          { icon: '✈️', ok: false },
          { icon: '📍', ok: false, offline: true },
        ];
  }, [forecastStatus, radarFeed.status, radarFeed.frames.length]);

  return (
    <div className="relative box-border h-full min-h-[100dvh] min-h-[100svh] w-full overflow-hidden bg-[#020617]">

      {/* Storm / METAR alert — fixed top (Samui or Krabi conflict product) */}
      <StormAlertBanner
        region={region.isSamuiProduct ? 'samui' : 'krabi'}
        onActiveChange={setStormBannerActive}
      />

      {/* ── Base map: satellite + radar + POIs ─ */}
      <div className="absolute inset-0 z-0 min-h-0">
        <SamuiExploreMap
          key={dashboardRegionId}
          flyToRequest={flyToRequest}
          onPoiSelect={region.isSamuiProduct ? setSelectedMapPoi : undefined}
          initialLongitude={region.lon + region.lngOffset}
          initialLatitude={region.lat + region.latOffset}
          initialZoom={region.mapZoom}
          showIslandPois={region.isSamuiProduct}
          homeLocationPins={
            region.homePins?.map(p => ({
              lat: p.lat,
              lng: p.lon,
              label: p.label,
              area: p.area,
              badge: p.badge,
            })) ?? null
          }
          mapScaleContextLabel={region.isSamuiProduct ? 'island' : 'coast'}
          radarScrub={radarScrubFrame}
          mapFooterHolidayLine={HOLIDAY_MAP_FOOTER_LINE}
          radarOverlayUrl={radarOverlayUrl}
          onRadarOverlayClear={handleRadarOverlayClear}
          onRefreshLive={radarFeed.refresh}
        />

        {/* Hybrid 18h strip on map only when rain is relevant — drawer still has compact/outlook */}
        {rainPossibleNext6h && (
          <div className="pointer-events-none absolute bottom-[7.25rem] left-1/2 z-[18] w-[min(98vw,52rem)] -translate-x-1/2 px-2 sm:bottom-[7.75rem]">
            <RadarHourlyTimeline
              key={dashboardRegionId}
              lat={region.lat}
              lon={region.lon}
              product={region.isSamuiProduct ? 'samui' : 'krabi'}
              forecastRows={spireWithSammi}
              windDirDeg={displayForecastRows[0]?.windDir ?? 0}
              radarScrub={radarScrubFrame}
              onRadarScrub={setRadarScrubFrame}
              onRadarOverlayUrl={setRadarOverlayUrl}
            />
          </div>
        )}
      </div>

      {/* POI detail — to the right of top-left drawer on desktop */}
      {selectedMapPoi && (
        <div
          className={[
            'pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-3 sm:inset-x-auto sm:left-[calc(1rem+28rem+0.75rem)] sm:right-4 sm:justify-start sm:px-0',
            stormBannerActive ? 'pt-28 sm:pt-32' : 'pt-14 sm:pt-16',
          ].join(' ')}
          aria-live="polite"
        >
          <div className="pointer-events-auto w-full max-w-[min(22rem,100%-1.5rem)] sm:max-w-[22rem]">
            <PoiIntelligenceCard
              poi={selectedMapPoi}
              onClose={() => setSelectedMapPoi(null)}
            />
          </div>
        </div>
      )}

      {/* ── Weather drawer — above map layer (z-0); Sammi HUD is inside map but drawer must stay clickable ─ */}
      <div
        className={[
          'absolute left-0 top-0 z-30 w-full max-w-md px-3 sm:left-4 sm:top-4 sm:px-0',
          stormBannerActive ? 'pt-14 sm:pt-[4.5rem]' : 'pt-3 sm:pt-0',
        ].join(' ')}
      >

        {/* Region tabs — Samui vs Krabi test */}
        <div className="mb-2 flex rounded-2xl border border-white/10 bg-slate-950/90 p-1 shadow-lg backdrop-blur-md">
          {DASHBOARD_REGION_TAB_ORDER.map((id) => {
            const r = getDashboardRegion(id);
            const active = dashboardRegionId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setDashboardRegionId(id)}
                className={[
                  'flex-1 rounded-xl px-2 py-2 text-center text-[9px] font-black uppercase tracking-wide transition',
                  active
                    ? 'bg-cyan-500/25 text-cyan-100 ring-1 ring-cyan-400/40'
                    : 'text-slate-500 hover:bg-white/5 hover:text-slate-300',
                ].join(' ')}
              >
                {r.shortLabel}
              </button>
            );
          })}
        </div>

        {/* Toggle bar — always visible */}
        <button
          type="button"
          suppressHydrationWarning
          onClick={() => setIsDashboardOpen(o => !o)}
          aria-expanded={isDashboardOpen}
          className={[
            'flex w-full items-center justify-between gap-3 px-5 py-3 text-white',
            'shadow-2xl transition-all duration-300',
            'border border-cyan-500/15 backdrop-blur-xl',
            isDashboardOpen
              ? 'rounded-t-3xl border-b-0'
              : 'rounded-3xl border-b border-white/10',
            'bg-slate-950/85',
          ].join(' ')}
        >
          <div className="flex min-w-0 items-center gap-3">
            {/* Radar pulse icon */}
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-50" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-500" />
            </span>

            <div className="min-w-0 text-left">
              <span className="block truncate text-[10px] font-black uppercase tracking-widest text-cyan-400">
                {region.title}
              </span>
              {region.subtitle && (
                <span className="mt-0.5 block truncate text-[8px] font-semibold text-slate-500">
                  {region.subtitle}
                </span>
              )}
            </div>

            {/* Compact source dots */}
            <div className="flex items-center gap-1">
              {sourceStatus.map((s, i) => (
                <span key={i} title={s.icon} className="flex items-center gap-0.5">
                  <span className="text-[9px] leading-none">{s.icon}</span>
                  <span className={`h-1 w-1 rounded-full ${
                    s.offline ? 'bg-slate-600' : s.ok ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                  }`} />
                </span>
              ))}
            </div>
          </div>

          <span className={`shrink-0 text-[11px] text-slate-400 transition-transform duration-300 ${isDashboardOpen ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </button>

        {/* Collapsible body */}
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isDashboardOpen ? 'max-h-[82vh]' : 'max-h-0'}`}>
          <div
            ref={drawerBodyScrollRef}
            className="max-h-[78vh] overflow-y-auto rounded-b-3xl border border-t-0 border-cyan-500/10 bg-slate-950/90 p-5 text-white shadow-2xl backdrop-blur-xl ring-1 ring-cyan-500/5 transition-colors duration-700"
          >

            {/* Scroll anchor for storm banner */}
            <div id="live-samui-intel" />

            {/* Future time banner */}
            {selectedTimeStr && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="text-[10px] font-bold text-amber-300">Viewing forecast: {selectedTimeStr}</span>
                <button
                  onClick={() => setSelectedIndex(0)}
                  className="ml-auto text-[9px] font-bold text-slate-400 hover:text-white"
                >
                  ← Now
                </button>
              </div>
            )}

            {forecastStatus === 'loading' && forecastRows.length === 0 && (
              <div className="flex flex-col gap-2 rounded-2xl border border-teal-200/15 bg-white/5 px-4 py-6 text-sm text-slate-400">
                <div className="flex items-center gap-3">
                  <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                  <span>Fetching forecast…</span>
                </div>
                <p className="pl-7 text-[10px] leading-relaxed text-slate-500">
                  Pulling Spire satellite data (usually a few seconds). If you just refreshed, the next load is cached for a faster start.
                </p>
              </div>
            )}

            {forecastStatus === 'error' && forecastRows.length === 0 && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
                <p className="font-bold text-amber-200">Forecast unavailable</p>
                <p className="mt-2 text-xs text-amber-100/80">{forecastError}</p>
                <p className="mt-3 text-[10px] text-slate-400">
                  Check <code className="text-cyan-400">SPIRE_API_TOKEN</code> in{' '}
                  <code>.env.local</code> and restart <code className="text-cyan-400">npm run dev</code>.
                </p>
              </div>
            )}

            {forecastStatus === 'ok' && weather && (
              <>
                {radarLeadsOverDryModels && (
                  <div className="mb-3 rounded-xl border border-sky-500/45 bg-sky-950/55 px-3 py-2 text-[10px] leading-snug text-sky-50/95">
                    <span className="font-bold text-sky-300">Rain on the map right now</span>{' '}
                    The radar shows wet weather here even though the first hour in the list still looks dry — watch the sky
                    and find cover if you need to.
                  </div>
                )}
                <VacationDashboard
                  rows={displayForecastRows}
                  selectedIndex={selectedIndex}
                  onSelectedIndexChange={setSelectedIndex}
                  tideTrend={tideTrend}
                  tideHeightM={tideHeightM}
                  sunLatitude={region.lat}
                  sunLongitude={region.lon}
                  radarLeadsOverDryModels={radarLeadsOverDryModels}
                  metarSkyCover={metarSkyCover}
                  sammiDailyByIsoDay={sammiDailyByIsoDay}
                  productRegion={region.isSamuiProduct ? 'samui' : 'krabi'}
                />

                <div className="mb-3 mt-4">
                  <ShowerNowcastCard
                    latitude={region.lat}
                    longitude={region.lon}
                    windSpeedMs={displayForecastRows[0]?.windSpeed ?? 0}
                    windDirDeg={displayForecastRows[0]?.windDir ?? 0}
                    nowcastFrames={radarFeed.nowcastFrames}
                    pastFrames={radarFeed.frames}
                    radarReady={radarFeed.status === 'ready'}
                    rainPossibleNext6h={rainPossibleNext6h}
                    forecastRows={displayForecastRows}
                    product={region.isSamuiProduct ? 'samui' : 'krabi'}
                    radarScrub={radarScrubFrame}
                    onRadarScrub={setRadarScrubFrame}
                  />
                </div>

                {/* Tide & Beach */}
                <div className="mb-3 mt-4">
                  <button
                    onClick={() => setShowTide(!showTide)}
                    className="flex w-full items-center justify-between rounded-xl border border-teal-200/12 bg-white/5 px-4 py-2 text-left transition hover:bg-white/10"
                  >
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">🌊 Tides &amp; beach</span>
                    <span className="text-[10px] text-slate-500">{showTide ? '▲' : '▼'}</span>
                  </button>
                  {showTide && (
                    <div className="mt-2">
                      <TideCard
                        trend={tideTrend}
                        heightM={tideHeightM}
                        nextExtremum={tideRaw ? getNextTideExtremum(tideRaw) : null}
                        tideDataSource={getTideDataSource(tideRaw)}
                      />
                    </div>
                  )}
                </div>

                {/* UV + Air */}
                <div className="mb-3">
                  <button
                    onClick={() => setShowAirUV(!showAirUV)}
                    className="flex w-full items-center justify-between rounded-xl border border-teal-200/12 bg-white/5 px-4 py-2 text-left transition hover:bg-white/10"
                  >
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">☀️ UV Index · 💨 Air Quality</span>
                    <span className="text-[10px] text-slate-500">{showAirUV ? '▲' : '▼'}</span>
                  </button>
                  {showAirUV && (
                    <div className="mt-2 flex flex-col gap-3">
                      <UVIndexCard
                        latitude={region.lat}
                        longitude={region.lon}
                        windSpeedMs={weather.windSpeed}
                        windDirDeg={weather.windDir}
                      />
                      <AirQualityCard latitude={region.lat} longitude={region.lon} />
                    </div>
                  )}
                </div>

                {/* Airport METAR — Samui, Krabi, Phuket (aviationweather.gov) */}
                <div className="mb-3">
                  <button
                    onClick={() => setShowMetar(!showMetar)}
                    className="flex w-full items-center justify-between rounded-xl border border-teal-200/12 bg-white/5 px-4 py-2 text-left transition hover:bg-white/10"
                  >
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      ✈️ Airport METAR &amp; TAF · USM · KBV · HKT
                    </span>
                    <span className="text-[10px] text-slate-500">{showMetar ? '▲' : '▼'}</span>
                  </button>
                  {showMetar && (
                    <div className="mt-2">
                      <MetarCard
                        key={dashboardRegionId}
                        defaultIcao={
                          dashboardRegionId === 'krabi_baan_mook_taley' ? 'VTSG' : 'VTSM'
                        }
                      />
                    </div>
                  )}
                </div>

                {region.isSamuiProduct && (
                  <>
                    {/* Ecowitt */}
                    <div className="mb-3">
                      <EcowittPlaceholder />
                    </div>

                    {/* Live webcams */}
                    <div className="mb-3">
                      <button
                        onClick={() => setShowCams(!showCams)}
                        className="flex w-full items-center justify-between rounded-xl border border-teal-200/12 bg-white/5 px-4 py-2 text-left transition hover:bg-white/10"
                      >
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">📹 Sammi&apos;s Eyes · Live Island View</span>
                        <span className="text-[10px] text-slate-500">{showCams ? '▲' : '▼'}</span>
                      </button>
                      {showCams && <div className="mt-2"><WebcamGrid /></div>}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sammi — portaled into map under Zoom / Scale / Radar (see #sammi-chat-anchor) */}
      {forecastStatus === 'ok' && forecastRows.length > 0 && (
        <SammiChatPortal
          forecastRows={displayForecastRows}
          onMapFlyTo={region.isSamuiProduct ? handleMapFlyTo : undefined}
          conflictRegion={region.isSamuiProduct ? 'samui' : 'krabi'}
          mapRegionKey={dashboardRegionId}
        />
      )}
    </div>
  );
}
