'use client';

import React, { useEffect, useState } from 'react';
import Map, { Source, Layer } from 'react-map-gl/mapbox';
import type { SamuiWeatherForecastRow } from '../lib/spire';
import type { TideTrend } from '../lib/tides';
import { getTideTrend } from '../lib/tides';
import { radarTimestampFromForecastIso } from '../lib/vacation';
import WindCompass from './WindCompass';
import VacationDashboard from './VacationDashboard';
import 'mapbox-gl/dist/mapbox-gl.css';

function TideBadge({ trend }: { trend: TideTrend }) {
  if (trend === 'unknown') {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Tide: —
      </div>
    );
  }

  const isRising = trend === 'rising';
  const label = isRising ? 'Stijgend' : trend === 'falling' ? 'Dalend' : 'Stabiel';
  const color = isRising
    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
    : trend === 'falling'
      ? 'text-sky-400 border-sky-500/30 bg-sky-500/10'
      : 'text-slate-400 border-white/10 bg-slate-950/60';

  return (
    <div
      className={`rounded-2xl border px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${color}`}
    >
      <span className="opacity-70">Getij </span>
      {label}
    </div>
  );
}

export default function MapViewer() {
  const [forecastRows, setForecastRows] = useState<SamuiWeatherForecastRow[]>(
    [],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tideTrend, setTideTrend] = useState<TideTrend>('unknown');

  const weather = forecastRows[selectedIndex] ?? null;

  useEffect(() => {
    fetch('/api/spire/forecast')
      .then((res) => res.json())
      .then((data: unknown) => {
        if (!Array.isArray(data) || data.length === 0) {
          setForecastRows([]);
          return;
        }
        const rows = data as SamuiWeatherForecastRow[];
        setForecastRows(rows);
        setSelectedIndex(0);
      })
      .catch(() => setForecastRows([]));
  }, []);

  useEffect(() => {
    if (forecastRows.length === 0) return;
    setSelectedIndex((i) => Math.min(i, forecastRows.length - 1));
  }, [forecastRows.length]);

  useEffect(() => {
    fetch('/api/tides')
      .then((res) => res.json())
      .then((raw: unknown) => setTideTrend(getTideTrend(raw)))
      .catch(() => setTideTrend('unknown'));
  }, []);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const radarTime = weather
    ? radarTimestampFromForecastIso(weather.time)
    : Math.floor(Date.now() / 1000 / 600) * 600;

  if (!token) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 px-6 text-center text-sm text-slate-400">
        Stel <code className="mx-1 text-cyan-400">NEXT_PUBLIC_MAPBOX_TOKEN</code> in
        in <code className="mx-1">.env.local</code>.
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 w-full">
      <Map
        initialViewState={{
          longitude: 100.0136,
          latitude: 9.512,
          zoom: 12,
          pitch: 60,
        }}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        mapboxAccessToken={token}
        terrain={{ source: 'mapbox-dem', exaggeration: 1.5 }}
        fog={{
          color: '#1e293b',
          range: [0.5, 10],
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
            key={`radar-${radarTime}`}
            id="radar"
            type="raster"
            tiles={[
              `https://tilecache.rainviewer.com/v2/radar/${radarTime}/512/{z}/{x}/{y}/2/1_1.png`,
            ]}
            tileSize={256}
          >
            <Layer
              id="radar-layer"
              type="raster"
              paint={{ 'raster-opacity': 0.5 }}
            />
          </Source>
        )}
      </Map>

      {weather && (
        <div className="absolute bottom-6 left-4 right-4 max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-slate-900/85 p-6 text-white shadow-2xl backdrop-blur-md sm:bottom-10 sm:left-10 sm:right-auto">
          <h2 className="mb-4 text-xs font-black uppercase tracking-widest text-cyan-400">
            Live Samui Intel
          </h2>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <TideBadge trend={tideTrend} />
          </div>

          <div className="flex flex-wrap items-stretch gap-4">
            <div className="flex items-center gap-4 rounded-2xl border border-white/5 bg-white/5 p-4">
              <WindCompass direction={weather.windDir} size={50} />
              <div>
                <p className="mb-1 text-[9px] font-black uppercase text-cyan-400">
                  Wind
                </p>
                <p className="font-mono text-xl tracking-tighter">
                  {weather.windSpeed}
                  <span className="ml-1 text-xs opacity-50">kts</span>
                </p>
                <p className="text-[10px] font-bold uppercase text-slate-500">
                  {weather.windDir}°
                </p>
              </div>
            </div>

            <div className="flex min-w-[120px] flex-1 flex-col justify-center rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
              <p className="mb-1 text-[9px] font-black uppercase text-slate-400">
                Temperature
              </p>
              <p className="text-4xl font-light">{weather.temp}°C</p>
            </div>
          </div>

          <VacationDashboard
            rows={forecastRows}
            selectedIndex={selectedIndex}
            onSelectedIndexChange={setSelectedIndex}
          />
        </div>
      )}
    </div>
  );
}
