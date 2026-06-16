'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { EcowittLatestResponse } from '../app/api/ecowitt/latest/route';
import type { EcowittObservation } from '../types/supabase';
import DataFreshnessBadge from './DataFreshnessBadge';
import { ageLabel, ageMinutes } from '../lib/data-freshness';
import type { SourceFreshness } from '../lib/data-freshness';

const STALE_MINUTES = 20;
const REFRESH_MS = 60_000;

function fmtNum(n: number | null | undefined, digits = 1, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
}

function msToKmh(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.round(ms * 3.6 * 10) / 10;
}

function windCardinal(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx];
}

function ecowittFreshness(observedAt: string): SourceFreshness {
  const unix = Math.floor(new Date(observedAt).getTime() / 1000);
  const age = ageMinutes(unix);
  const stale = age > STALE_MINUTES;
  const syncTimeIct = new Date(observedAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  });

  return {
    ageMinutes: age,
    label: ageLabel(age),
    isStale: stale,
    staleThresholdMinutes: STALE_MINUTES,
    sammiNote: stale
      ? `My Baan Ton Kluay station last checked in ${age} minutes ago — I'll trust radar and METAR until the mesh link catches up.`
      : null,
    syncTimeIct,
  };
}

function sensorStatus(
  value: number | null | undefined,
  freshness: SourceFreshness,
): 'ONLINE' | 'STALE' | 'OFFLINE' {
  if (value == null || !Number.isFinite(value)) return 'OFFLINE';
  return freshness.isStale ? 'STALE' : 'ONLINE';
}

function SensorRow({
  icon,
  name,
  value,
  status,
}: {
  icon: string;
  name: string;
  value: string;
  status: 'ONLINE' | 'STALE' | 'OFFLINE';
}) {
  const dot =
    status === 'ONLINE'
      ? 'bg-emerald-400'
      : status === 'STALE'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-slate-600';
  const statusColor =
    status === 'ONLINE'
      ? 'text-emerald-400'
      : status === 'STALE'
        ? 'text-amber-400'
        : 'text-slate-600';

  return (
    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/3 px-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs">{icon}</span>
        <span className="text-[10px] text-slate-400">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono tabular-nums text-slate-200">{value}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className={`text-[9px] font-bold ${statusColor}`}>{status}</span>
      </div>
    </div>
  );
}

function sammiQuote(obs: EcowittObservation | null, freshness: SourceFreshness | null): string {
  if (!obs) {
    return '"The array is installed at Baan Ton Kluay — I\'m waiting for the first upload from the Ecowitt gateway. Once it lands, you\'ll see ground-truth rain and UV right here."';
  }
  if (freshness?.isStale) {
    return `"My villa sensors went quiet ${freshness.ageMinutes} minutes ago — unusual for the mesh. I'm still reading radar and USM until they check back in."`;
  }
  const raining = (obs.rainRateMmh ?? 0) > 0.05;
  if (raining) {
    return `"Ground truth: ${fmtNum(obs.rainRateMmh, 2)} mm/h at Baan Ton Kluay right now. That's the number I trust when radar and satellites disagree."`;
  }
  return '"My Baan Ton Kluay sensors are online. Hyper-local temperature, rain, wind, and UV — ground truth within ~50 metres of the villa."';
}

export default function EcowittPlaceholder() {
  const [data, setData] = useState<EcowittLatestResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch('/api/ecowitt/latest', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: EcowittLatestResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const obs = data?.observation ?? null;
  const freshness = obs ? ecowittFreshness(obs.observedAt) : null;
  const offlineFreshness: SourceFreshness = {
    ageMinutes: 999,
    label: 'no data',
    isStale: true,
    staleThresholdMinutes: STALE_MINUTES,
    sammiNote: null,
    syncTimeIct: '—',
  };
  const sensorFreshness = freshness ?? offlineFreshness;
  const online = obs != null && freshness != null && !freshness.isStale;
  const hasData = obs != null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/5 px-4 py-5 text-xs text-slate-400">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
        Loading Baan Ton Kluay station…
      </div>
    );
  }

  const headerBadge = online
    ? '✓ ONLINE'
    : hasData
      ? '⚠ STALE'
      : '⏳ AWAITING DATA';

  const headerClass = online
    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
    : hasData
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      : 'border-slate-500/30 bg-slate-500/10 text-slate-400';

  const windKmh = msToKmh(obs?.windSpeedMs);
  const gustKmh = msToKmh(obs?.windGustMs);
  const windStr =
    windKmh != null
      ? `${fmtNum(windKmh, 1)} km/h ${windCardinal(obs?.windDirectionDeg)}${gustKmh != null ? ` (gust ${fmtNum(gustKmh, 1)})` : ''}`
      : '—';

  return (
    <div className="overflow-hidden rounded-2xl border border-white/15 bg-white/3">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm">📍</span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
              Local Precision
            </p>
            <p className="text-[9px] text-slate-500">Baan Ton Kluay · Koh Samui</p>
          </div>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${headerClass}`}
        >
          {headerBadge}
        </span>
      </div>

      <div className="p-4">
        {freshness && (
          <div className="mb-3">
            <DataFreshnessBadge
              label="Ecowitt ground station"
              icon="📡"
              freshness={freshness}
            />
          </div>
        )}

        {!hasData && data?.error && (
          <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-300">
            {data.error === 'No observations yet'
              ? 'No uploads yet — point the Ecowitt custom server at /api/ecowitt/ingest with your secret.'
              : data.error}
          </p>
        )}

        <div className="mb-3 space-y-1.5">
          <SensorRow
            icon="🌡️"
            name="Outdoor temperature"
            value={obs?.temperatureC != null ? `${fmtNum(obs.temperatureC, 1)} °C` : '—'}
            status={sensorStatus(obs?.temperatureC, sensorFreshness)}
          />
          <SensorRow
            icon="💧"
            name="Rain rate"
            value={obs?.rainRateMmh != null ? `${fmtNum(obs.rainRateMmh, 2)} mm/h` : '—'}
            status={sensorStatus(obs?.rainRateMmh, sensorFreshness)}
          />
          <SensorRow
            icon="💨"
            name="Wind"
            value={windStr}
            status={sensorStatus(obs?.windSpeedMs, sensorFreshness)}
          />
          <SensorRow
            icon="☀️"
            name="UV index"
            value={obs?.uvIndex != null ? fmtNum(obs.uvIndex, 1) : '—'}
            status={sensorStatus(obs?.uvIndex, sensorFreshness)}
          />
          <SensorRow
            icon="🔆"
            name="Solar"
            value={obs?.solarWm2 != null ? `${fmtNum(obs.solarWm2, 0)} W/m²` : '—'}
            status={sensorStatus(obs?.solarWm2, sensorFreshness)}
          />
        </div>

        {obs && (
          <div className="mb-3 grid grid-cols-2 gap-2 text-[10px] text-slate-400">
            <div className="rounded-lg border border-white/5 bg-white/3 px-2.5 py-1.5">
              <p className="text-[8px] font-bold uppercase tracking-wider text-slate-600">Humidity</p>
              <p className="font-mono text-slate-200">{fmtNum(obs.humidityPct, 0, '%')}</p>
            </div>
            <div className="rounded-lg border border-white/5 bg-white/3 px-2.5 py-1.5">
              <p className="text-[8px] font-bold uppercase tracking-wider text-slate-600">Rain today</p>
              <p className="font-mono text-slate-200">{fmtNum(obs.rainDayMm, 1, ' mm')}</p>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
          <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
            ✨ Sammi says
          </p>
          <p className="text-[11px] italic leading-relaxed text-slate-300">
            {sammiQuote(obs, freshness)}
          </p>
        </div>

        <p className="mt-2.5 text-center text-[9px] text-slate-600">
          Ecowitt HP2550 Pro · 5-in-1 array · Solar powered · Samui WiFi mesh
        </p>
      </div>
    </div>
  );
}
