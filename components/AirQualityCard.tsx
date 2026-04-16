'use client';

import React, { useEffect, useState } from 'react';
import type { AirQualityData } from '../app/api/airquality/route';

// ─── AQI scale (EPA / WAQI) ──────────────────────────────────────────────────

type AqiLevel = 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'very_unhealthy' | 'hazardous' | 'unknown';

function aqiLevel(aqi: number): AqiLevel {
  if (aqi <= 50)  return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'sensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very_unhealthy';
  return 'hazardous';
}

const aqiConfig: Record<
  AqiLevel,
  { icon: string; label: string; cardBg: string; border: string; iconRing: string; labelColor: string; dotColor: string; hint: string }
> = {
  good:          { icon: '😊', label: 'Good',            cardBg: 'from-slate-900/80 via-emerald-950/60 to-teal-950/70',    border: 'border-emerald-500/30', iconRing: 'bg-emerald-500/20 ring-emerald-400/30', labelColor: 'text-emerald-200', dotColor: 'bg-emerald-400', hint: 'Air is clean. Safe to enjoy outdoors.' },
  moderate:      { icon: '😐', label: 'Moderate',        cardBg: 'from-slate-900/80 via-yellow-950/50 to-amber-950/60',   border: 'border-yellow-500/30',  iconRing: 'bg-yellow-500/20 ring-yellow-400/30',  labelColor: 'text-yellow-200', dotColor: 'bg-yellow-400', hint: 'Acceptable, but sensitive individuals take care.' },
  sensitive:     { icon: '😷', label: 'Sensitive',       cardBg: 'from-slate-900/80 via-orange-950/50 to-amber-950/70',   border: 'border-orange-500/30',  iconRing: 'bg-orange-500/20 ring-orange-400/30',  labelColor: 'text-orange-200', dotColor: 'bg-orange-400', hint: 'Sensitive groups: limit prolonged outdoor exposure.' },
  unhealthy:     { icon: '🤧', label: 'Unhealthy',       cardBg: 'from-slate-900/80 via-red-950/60 to-rose-950/70',       border: 'border-red-500/35',     iconRing: 'bg-red-500/20 ring-red-400/30',        labelColor: 'text-red-200',    dotColor: 'bg-red-400',    hint: 'Everyone may experience health effects.' },
  very_unhealthy:{ icon: '☣️', label: 'Very Unhealthy',  cardBg: 'from-slate-900/80 via-purple-950/60 to-fuchsia-950/70', border: 'border-purple-500/35',  iconRing: 'bg-purple-500/20 ring-purple-400/30',  labelColor: 'text-purple-200', dotColor: 'bg-purple-400', hint: 'Health alert. Avoid all outdoor activity.' },
  hazardous:     { icon: '☠️', label: 'Hazardous',       cardBg: 'from-slate-900/80 via-rose-950/70 to-red-950/80',       border: 'border-rose-600/50',    iconRing: 'bg-rose-600/25 ring-rose-500/40',      labelColor: 'text-rose-200',   dotColor: 'bg-rose-500',   hint: 'Emergency conditions. Stay indoors.' },
  unknown:       { icon: '🌫️', label: '—',               cardBg: 'from-slate-900/80 to-slate-800/80',                     border: 'border-white/10',       iconRing: 'bg-white/5 ring-white/10',             labelColor: 'text-slate-400',  dotColor: 'bg-slate-500', hint: 'Data not available.' },
};

// ─── component ───────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'ok' | 'error';

export default function AirQualityCard() {
  const [data, setData] = useState<AirQualityData | null>(null);
  const [status, setStatus] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    fetch('/api/airquality', { signal: controller.signal })
      .then(async (res) => {
        clearTimeout(timer);
        const json = await res.json() as AirQualityData & { error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        setData(json);
        setStatus('ok');
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        const msg = err instanceof Error
          ? err.name === 'AbortError' ? 'Timeout — air quality API did not respond' : err.message
          : 'Unknown error';
        setErrorMsg(msg);
        setStatus('error');
      });

    return () => { clearTimeout(timer); controller.abort(); };
  }, []);

  if (status === 'loading') return <CardSkeleton label="Air Quality" />;
  if (status === 'error' || !data) return <CardError label="Air Quality" detail={errorMsg} />;

  const level = aqiLevel(data.aqi);
  const cfg = aqiConfig[level];

  return (
    <div
      className={`
        relative w-full overflow-hidden rounded-3xl border
        bg-gradient-to-br ${cfg.cardBg} ${cfg.border}
        shadow-[0_4px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl
        transition-all duration-700
      `}
    >
      <div className="pointer-events-none absolute -left-10 top-0 h-full w-24 rotate-12 bg-white/[0.025]" />

      <div className="flex h-full flex-col px-5 py-4">
        {/* top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl ring-1 ${cfg.iconRing} select-none`}
              aria-hidden
            >
              {cfg.icon}
            </span>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-white/40">
                AQI Score
              </p>
              <p className={`text-xl font-extrabold leading-tight ${cfg.labelColor}`}>
                {data.aqi}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-white/60">
                {data.pm25 != null ? `PM2.5: ${data.pm25} µg/m³` : '—'}
              </p>
            </div>
          </div>
          <div className="text-right flex flex-col items-end justify-center">
            <p className="text-[9px] font-bold uppercase tracking-widest text-white/35">Status</p>
            <p className={`text-xs font-extrabold leading-tight ${cfg.labelColor} whitespace-pre-wrap max-w-[90px]`}>
              {cfg.label}
            </p>
          </div>
        </div>

        <div className="my-3 h-px bg-white/8" />

        {/* bottom row */}
        <div className="mt-auto pt-2">
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-white/40">
            Health Advisory
          </p>
          <div className="flex items-start gap-2 min-h-[36px]">
            <span className={`mt-[3px] h-2 w-2 shrink-0 rounded-full ${cfg.dotColor}`} />
            <div>
              <p className={`text-sm font-bold leading-snug ${cfg.labelColor}`}>
                {cfg.label}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-white/45">
                {cfg.hint}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── shared skeleton / error states ─────────────────────────────────────────

function CardSkeleton({ label }: { label: string }) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-800/80 shadow-[0_4px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="flex h-full flex-col px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 animate-pulse rounded-2xl bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-2 w-20 animate-pulse rounded bg-white/10" />
            <div className="h-5 w-28 animate-pulse rounded bg-white/10" />
          </div>
        </div>
        <div className="my-3 h-px bg-white/8" />
        <p className="text-[9px] font-black uppercase tracking-widest text-white/25">{label} loading…</p>
      </div>
    </div>
  );
}

function CardError({ label, detail }: { label: string; detail?: string | null }) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-3xl border border-rose-500/25 bg-gradient-to-br from-slate-900/80 to-rose-950/40 shadow-[0_4px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="flex h-full flex-col px-5 py-4">
        <p className="text-[9px] font-black uppercase tracking-widest text-white/40">{label}</p>
        <p className="mt-1 text-sm font-bold text-rose-300">Not available</p>
        <p className="mt-0.5 text-[10px] leading-snug text-white/45">
          {detail ?? 'Check NEXT_PUBLIC_AQICN_TOKEN in .env.local'}
        </p>
      </div>
    </div>
  );
}
