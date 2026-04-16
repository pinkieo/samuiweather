'use client';

import React, { useEffect, useState } from 'react';
import { formatTempC, formatWindKts } from '../lib/spire';
import Map, { Source, Layer, NavigationControl } from 'react-map-gl/mapbox';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type WeatherRow = {
  time: string;
  temp: number;
  windSpeed: number;
  windGust: number;
  windDir: number;
  precip: number;
  humidity: number;
};

function tideSummary(raw: unknown): string {
  if (raw === null || typeof raw !== 'object') return '—';
  const o = raw as Record<string, unknown>;
  const data = o.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown>;
    const values = first.values as Record<string, unknown> | undefined;
    if (values) {
      const h =
        values.tide_height ??
        values.height ??
        values.sea_surface_height_above_mean_sea_level;
      if (typeof h === 'number') {
        const cm = Math.round(h * 100);
        const sign = cm > 0 ? '+' : '';
        return `${sign}${cm} cm`;
      }
    }
  }
  return '—';
}

export default function SamuiMap() {
  const [radarTime, setRadarTime] = useState(0);
  const [weather, setWeather] = useState<WeatherRow | null>(null);
  const [tide, setTide] = useState<string>('—');
  const [wxError, setWxError] = useState(false);

  useEffect(() => {
    const time = Math.floor(Date.now() / 1000 / 600) * 600;
    setRadarTime(time);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/weather');
        if (!res.ok) throw new Error('weather');
        const rows = (await res.json()) as WeatherRow[];
        if (!cancelled && rows[0]) setWeather(rows[0]);
      } catch {
        if (!cancelled) setWxError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tides');
        if (!res.ok) throw new Error('tides');
        const raw = await res.json();
        if (!cancelled) setTide(tideSummary(raw));
      } catch {
        if (!cancelled) setTide('—');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 px-6 text-center text-sm text-slate-400">
        Stel <code className="mx-1 text-cyan-400">NEXT_PUBLIC_MAPBOX_TOKEN</code> in
        in <code className="mx-1">.env.local</code>.
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full bg-slate-950">
      <Map
        initialViewState={{
          longitude: 100.0136,
          latitude: 9.512,
          zoom: 11,
          pitch: 55,
          bearing: -15,
        }}
        mapStyle="mapbox://styles/mapbox/navigation-night-v1"
        mapboxAccessToken={MAPBOX_TOKEN}
        terrain={{ source: 'mapbox-dem', exaggeration: 1.8 }}
        fog={{
          color: 'rgb(15, 23, 42)',
          range: [0.5, 10],
          'high-color': 'rgb(30, 41, 59)',
          'space-color': 'rgb(0, 0, 0)',
          'horizon-blend': 0.2,
        }}
      >
        <Source
          id="mapbox-dem"
          type="raster-dem"
          url="mapbox://mapbox.mapbox-terrain-dem-v1"
          tileSize={512}
        />

        {radarTime > 0 && (
          <Source
            id="rainviewer-radar"
            type="raster"
            tiles={[
              `https://tilecache.rainviewer.com/v2/radar/${radarTime}/512/{z}/{x}/{y}/2/1_1.png`,
            ]}
            tileSize={256}
          >
            <Layer
              id="radar-layer"
              type="raster"
              paint={{
                'raster-opacity': 0.6,
                'raster-fade-duration': 500,
              }}
            />
          </Source>
        )}

        <NavigationControl position="top-right" />
      </Map>

      <div className="absolute left-10 top-10 z-10 w-80">
        <div className="rounded-[2rem] border border-white/10 bg-slate-900/60 p-8 text-white shadow-2xl backdrop-blur-2xl">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-black italic leading-none tracking-tighter">
                SAMUI<span className="text-3xl text-cyan-400">PRO</span>
              </h1>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">
                Marine Intelligence
              </p>
            </div>
            <div className="rounded-full border border-cyan-500/30 bg-cyan-500/20 px-3 py-1">
              <span className="animate-pulse text-[10px] font-bold text-cyan-400">
                LIVE
              </span>
            </div>
          </div>

          <div className="mt-10 space-y-6">
            <div className="flex items-center gap-4">
              <div className="text-5xl font-light">
                {weather ? `${formatTempC(weather.temp)}°` : wxError ? '—°' : '…'}
              </div>
              <div className="h-10 w-px bg-white/10" />
              <div>
                <p className="text-[10px] font-black uppercase text-slate-500">
                  Weather
                </p>
                <p className="text-sm font-bold">
                  {wxError ? 'Geen data' : weather ? 'Forecast' : 'Laden…'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
                <p className="mb-1 text-[9px] font-black uppercase text-cyan-400">
                  Wind
                </p>
                <p className="font-mono text-xl tracking-tighter">
                  {weather ? (
                    <>
                      {formatWindKts(weather.windSpeed)}
                      <span className="ml-1 text-xs opacity-50">kts</span>
                    </>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
                <p className="mb-1 text-[9px] font-black uppercase text-blue-400">
                  Tide
                </p>
                <p className="font-mono text-xl tracking-tighter">
                  {tide !== '—' ? (
                    <>
                      {tide}
                      <span className="ml-1 text-xs opacity-50">m</span>
                    </>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="mt-8 w-full rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 py-4 text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-cyan-500/20 transition-transform hover:scale-[1.02]"
          >
            Analyze Crossing
          </button>
        </div>
      </div>
    </div>
  );
}
