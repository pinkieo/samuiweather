'use client';

import dynamic from 'next/dynamic';
import React, { useEffect, useState } from 'react';
import type { SamuiWeatherForecastRow } from '../lib/spire';
import type { TideTrend } from '../lib/tides';
import { getFirstTideHeightM, getNextTideExtremum, getTideTrend } from '../lib/tides';
import { getSunInfo } from '../lib/sun';
import TideCard from './TideCard';
import AirQualityCard from './AirQualityCard';
import UVIndexCard from './UVIndexCard';
import VacationDashboard from './VacationDashboard';
import SammiConcierge from './SammiConcierge';
import WebcamGrid from './WebcamGrid';
import MetarCard from './MetarCard';
import EcowittPlaceholder from './EcowittPlaceholder';
import StormAlertBanner from './StormAlertBanner';
import { getPoiById, type IslandPoi } from '../lib/island-pois';
import PoiIntelligenceCard from './PoiIntelligenceCard';
import { SAMUI_CENTER } from '../lib/spire';

const SamuiExploreMap = dynamic(() => import('./SamuiExploreMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#020617] text-[10px] text-slate-500">
      Loading map…
    </div>
  ),
});

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** meteoblue hourly snapshot at island center (same key as dashboard forecast). */
function MeteoblueModelStrip({ lat, lon }: { lat: number; lon: number }) {
  const [label, setLabel] = useState<string>('meteoblue: loading…');

  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/meteoblue/point?lat=${lat}&lon=${lon}`, { signal: c.signal })
      .then(r => r.json())
      .then((d: {
        ok?: boolean;
        enabled?: boolean;
        snapshot?: {
          tempC: number | null;
          windSpeedMs: number | null;
          windDirDeg: number | null;
        };
      }) => {
        if (d.enabled === false) {
          setLabel('meteoblue: add METEOBLUE_API_KEY');
          return;
        }
        if (!d.ok || !d.snapshot) {
          setLabel('meteoblue: unavailable');
          return;
        }
        const s = d.snapshot;
        const kts =
          s.windSpeedMs != null ? (s.windSpeedMs * 1.94384).toFixed(0) : '—';
        const t = s.tempC != null ? `${s.tempC}°C` : '—';
        const wd =
          s.windDirDeg != null
            ? DIRS[Math.round(s.windDirDeg / 22.5) % 16]
            : '—';
        setLabel(`meteoblue · ${t} · ${wd} ${kts} kts`);
      })
      .catch(() => setLabel('meteoblue: offline'));
    return () => c.abort();
  }, [lat, lon]);

  return (
    <div className="pointer-events-none absolute left-3 top-14 z-[8] max-w-[min(100%-1.5rem,22rem)] rounded-full border border-white/15 bg-slate-950/90 px-3 py-1.5 text-[9px] font-semibold text-slate-400 shadow-xl backdrop-blur-md sm:left-4 sm:top-16">
      {label}
    </div>
  );
}

export default function MapViewer() {
  const [forecastRows, setForecastRows] = useState<SamuiWeatherForecastRow[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tideTrend, setTideTrend]         = useState<TideTrend>('unknown');
  const [tideHeightM, setTideHeightM]     = useState<number | null>(null);
  const [tideRaw, setTideRaw]             = useState<unknown>(null);
  const [forecastStatus, setForecastStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [forecastError, setForecastError]   = useState<string | null>(null);

  // Dashboard collapse — closed on mobile by default, open on desktop
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  useEffect(() => {
    if (window.innerWidth >= 640) setIsDashboardOpen(true);
  }, []);

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

  const handleMapFlyTo = (locationId: string) => {
    const p = getPoiById(locationId);
    if (!p) return;
    setFlyToRequest({
      key: Date.now(),
      lng: p.lon,
      lat: p.lat,
      zoom: 16.2,
    });
  };

  const weather = forecastRows[selectedIndex] ?? null;
  const isNight = weather ? !getSunInfo(new Date(weather.time)).isDay : false;

  // Future forecast banner
  const isFuture = selectedIndex > 0 && forecastRows.length > 0;
  const selectedTimeStr = isFuture && weather
    ? new Date(weather.time).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'Asia/Bangkok',
      })
    : null;

  // ── SPIRE forecast ──────────────────────────────────────────────────────────
  useEffect(() => {
    setForecastStatus('loading');
    setForecastError(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    fetch('/api/spire/forecast', { signal: controller.signal })
      .then(async (res) => {
        clearTimeout(timer);
        const data: unknown = await res.json();
        if (!res.ok) {
          const err =
            typeof data === 'object' && data !== null && 'error' in data &&
            typeof (data as { error: unknown }).error === 'string'
              ? (data as { error: string }).error
              : `HTTP ${res.status}`;
          setForecastRows([]);
          setForecastError(err);
          setForecastStatus('error');
          return;
        }
        if (!Array.isArray(data) || data.length === 0) {
          setForecastRows([]);
          setForecastError('No forecast data from API');
          setForecastStatus('error');
          return;
        }
        setForecastRows(data as SamuiWeatherForecastRow[]);
        setSelectedIndex(0);
        setForecastStatus('ok');
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        setForecastRows([]);
        setForecastError(isTimeout ? 'Timeout – Spire API not responding' : 'Network error');
        setForecastStatus('error');
      });

    return () => { clearTimeout(timer); controller.abort(); };
  }, []);

  useEffect(() => {
    if (forecastRows.length === 0) return;
    setSelectedIndex(i => Math.min(i, forecastRows.length - 1));
  }, [forecastRows.length]);

  // ── Tides ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    fetch('/api/tides', { signal: controller.signal })
      .then(res => { clearTimeout(timer); return res.json(); })
      .then((raw: unknown) => {
        setTideRaw(raw);
        setTideTrend(getTideTrend(raw));
        setTideHeightM(getFirstTideHeightM(raw));
      })
      .catch(() => {
        clearTimeout(timer);
        setTideRaw(null);
        setTideTrend('unknown');
        setTideHeightM(null);
      });

    return () => { clearTimeout(timer); controller.abort(); };
  }, []);

  // ── Status dot helper ────────────────────────────────────────────────────────
  const sourceStatus = forecastStatus === 'ok'
    ? [
        { icon: '🛰️', ok: true  },
        { icon: '🌧️', ok: true  },
        { icon: '✈️', ok: true  },
        { icon: '📍', ok: false, offline: true },
      ]
    : [
        { icon: '🛰️', ok: false },
        { icon: '🌧️', ok: false },
        { icon: '✈️', ok: false },
        { icon: '📍', ok: false, offline: true },
      ];

  return (
    <div className="relative box-border h-full min-h-[100dvh] min-h-[100svh] w-full overflow-hidden bg-[#020617]">

      {/* Storm alert — fixed top, storm_incoming / all_alarm only */}
      <StormAlertBanner />

      {/* ── Base map: satellite + radar + POIs ─ */}
      <div className="absolute inset-0 z-0 min-h-0">
        <MeteoblueModelStrip lat={SAMUI_CENTER.lat} lon={SAMUI_CENTER.lon} />
        <SamuiExploreMap
          key="map-surface-live"
          flyToRequest={flyToRequest}
          onPoiSelect={setSelectedMapPoi}
        />
      </div>

      {/* POI detail — fixed layer above drawer, aligned beside panel on desktop */}
      {selectedMapPoi && (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-14 sm:inset-x-auto sm:left-[calc(2.5rem+28rem+0.75rem)] sm:right-4 sm:justify-start sm:px-0 sm:pt-16"
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

      {/* ── Dashboard panel ─────────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-10 max-w-md sm:bottom-3 sm:left-10 sm:right-auto">

        {/* Toggle bar — always visible */}
        <button
          type="button"
          suppressHydrationWarning
          onClick={() => setIsDashboardOpen(o => !o)}
          aria-expanded={isDashboardOpen}
          className={[
            'flex w-full items-center justify-between gap-3 px-5 py-3 text-white',
            'shadow-2xl backdrop-blur-md transition-all duration-300',
            'border border-b-0 border-white/10',
            isDashboardOpen
              ? 'rounded-t-3xl sm:rounded-t-3xl sm:rounded-b-none'
              : 'rounded-3xl border-b border-white/10',
            isNight ? 'bg-slate-950/90' : 'bg-slate-900/90',
          ].join(' ')}
        >
          <div className="flex min-w-0 items-center gap-3">
            {/* Radar pulse icon */}
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-50" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-500" />
            </span>

            <span className="whitespace-nowrap text-[10px] font-black uppercase tracking-widest text-cyan-400">
              Samui Weather · Live radar
            </span>

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
          <div className={`max-h-[78vh] overflow-y-auto rounded-b-3xl border border-t-0 border-white/10 p-5 text-white shadow-2xl backdrop-blur-md transition-colors duration-700 ${isNight ? 'bg-slate-950/90' : 'bg-slate-900/88'}`}>

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

            {forecastStatus === 'loading' && (
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                Loading satellite data…
              </div>
            )}

            {forecastStatus === 'error' && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-100">
                <p className="font-bold text-amber-200">Satellite feed unavailable</p>
                <p className="mt-2 text-xs text-amber-100/80">{forecastError}</p>
                <p className="mt-3 text-[10px] text-slate-400">
                  Check <code className="text-cyan-400">SPIRE_API_TOKEN</code> in{' '}
                  <code>.env.local</code> and restart <code className="text-cyan-400">npm run dev</code>.
                </p>
              </div>
            )}

            {forecastStatus === 'ok' && weather && (
              <>
                <VacationDashboard
                  rows={forecastRows}
                  selectedIndex={selectedIndex}
                  onSelectedIndexChange={setSelectedIndex}
                  tideTrend={tideTrend}
                  tideHeightM={tideHeightM}
                />

                <SammiConcierge forecastRows={forecastRows} onMapFlyTo={handleMapFlyTo} />

                {/* Tide & Beach */}
                <div className="mb-3 mt-4">
                  <button
                    onClick={() => setShowTide(!showTide)}
                    className="flex w-full items-center justify-between rounded-xl border border-white/8 bg-white/5 px-4 py-2 text-left transition hover:bg-white/10"
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
                      />
                    </div>
                  )}
                </div>

                {/* UV + Air */}
                <div className="mb-3">
                  <button
                    onClick={() => setShowAirUV(!showAirUV)}
                    className="flex w-full items-center justify-between rounded-xl border border-white/8 bg-white/5 px-4 py-2 text-left transition hover:bg-white/10"
                  >
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">☀️ UV Index · 💨 Air Quality</span>
                    <span className="text-[10px] text-slate-500">{showAirUV ? '▲' : '▼'}</span>
                  </button>
                  {showAirUV && (
                    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <AirQualityCard />
                      <UVIndexCard />
                    </div>
                  )}
                </div>

                {/* Airport METAR */}
                <div className="mb-3">
                  <button
                    onClick={() => setShowMetar(!showMetar)}
                    className="flex w-full items-center justify-between rounded-xl border border-white/8 bg-white/5 px-4 py-2 text-left transition hover:bg-white/10"
                  >
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">✈️ VTSM Airport · METAR &amp; TAF</span>
                    <span className="text-[10px] text-slate-500">{showMetar ? '▲' : '▼'}</span>
                  </button>
                  {showMetar && <div className="mt-2"><MetarCard /></div>}
                </div>

                {/* Ecowitt */}
                <div className="mb-3">
                  <EcowittPlaceholder />
                </div>

                {/* Live webcams */}
                <div className="mb-3">
                  <button
                    onClick={() => setShowCams(!showCams)}
                    className="flex w-full items-center justify-between rounded-xl border border-white/8 bg-white/5 px-4 py-2 text-left transition hover:bg-white/10"
                  >
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">📹 Sammi&apos;s Eyes · Live Island View</span>
                    <span className="text-[10px] text-slate-500">{showCams ? '▲' : '▼'}</span>
                  </button>
                  {showCams && <div className="mt-2"><WebcamGrid /></div>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
