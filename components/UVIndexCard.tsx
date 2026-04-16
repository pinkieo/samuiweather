'use client';

import React, { useEffect, useState } from 'react';
import type { UVData } from '../app/api/uvindex/route';
import { getSunInfo, getSunInfoAt } from '../lib/sun';

// ─── UV scale (WHO) ───────────────────────────────────────────────────────────

type UVLevel = 'low' | 'moderate' | 'high' | 'very_high' | 'extreme' | 'unknown';

function uvLevel(uv: number): UVLevel {
  if (uv < 3)  return 'low';
  if (uv < 6)  return 'moderate';
  if (uv < 8)  return 'high';
  if (uv < 11) return 'very_high';
  return 'extreme';
}

const uvConfig: Record<
  UVLevel,
  { icon: string; label: string; cardBg: string; border: string; iconRing: string; labelColor: string; dotColor: string }
> = {
  low:      { icon: '☀️',  label: 'Low',        cardBg: 'from-slate-900/80 via-emerald-950/50 to-teal-950/60',     border: 'border-emerald-500/25', iconRing: 'bg-emerald-500/15 ring-emerald-400/25', labelColor: 'text-emerald-200', dotColor: 'bg-emerald-400' },
  moderate: { icon: '🌤️', label: 'Moderate',    cardBg: 'from-slate-900/80 via-yellow-950/45 to-amber-950/55',    border: 'border-yellow-500/30',  iconRing: 'bg-yellow-500/20 ring-yellow-400/30',  labelColor: 'text-yellow-200', dotColor: 'bg-yellow-400' },
  high:     { icon: '🔆',  label: 'High',        cardBg: 'from-slate-900/80 via-orange-950/50 to-amber-950/65',    border: 'border-orange-500/30',  iconRing: 'bg-orange-500/20 ring-orange-400/30',  labelColor: 'text-orange-200', dotColor: 'bg-orange-400' },
  very_high:{ icon: '🔥',  label: 'Very High',   cardBg: 'from-slate-900/80 via-red-950/55 to-rose-950/65',        border: 'border-red-500/35',     iconRing: 'bg-red-500/20 ring-red-400/30',        labelColor: 'text-red-200',    dotColor: 'bg-red-400'    },
  extreme:  { icon: '☢️',  label: 'Extreme',     cardBg: 'from-slate-900/80 via-purple-950/60 to-violet-950/75',   border: 'border-purple-500/40',  iconRing: 'bg-purple-500/25 ring-purple-400/35',  labelColor: 'text-purple-200', dotColor: 'bg-purple-400' },
  unknown:  { icon: '🌤️', label: '—',            cardBg: 'from-slate-900/80 to-slate-800/80',                      border: 'border-white/10',       iconRing: 'bg-white/5 ring-white/10',             labelColor: 'text-slate-400',  dotColor: 'bg-slate-500'  },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatBurnTime(minutes: number | null): string {
  if (minutes == null || minutes <= 0) return 'protect immediately';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  return `${h} ${h === 1 ? 'hour' : 'hours'} and ${rem} min`;
}

function formatMaxTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });
  } catch {
    return '—';
  }
}

// ─── component ───────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'ok' | 'error';

export default function UVIndexCard({
  latitude,
  longitude,
}: {
  latitude?: number;
  longitude?: number;
} = {}) {
  const [data, setData] = useState<UVData | null>(null);
  const [status, setStatus] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const q =
      latitude != null && longitude != null
        ? `?lat=${encodeURIComponent(String(latitude))}&lon=${encodeURIComponent(String(longitude))}`
        : '';
    fetch(`/api/uvindex${q}`, { signal: controller.signal })
      .then(async (res) => {
        clearTimeout(timer);
        const json = await res.json() as UVData & { error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        setData(json);
        setStatus('ok');
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        const msg = err instanceof Error
          ? err.name === 'AbortError' ? 'Timeout — UV API did not respond' : err.message
          : 'Unknown error';
        setErrorMsg(msg);
        setStatus('error');
      });

    return () => { clearTimeout(timer); controller.abort(); };
  }, [latitude, longitude]);

  if (status === 'loading') return <CardSkeleton label="UV Index" />;
  if (status === 'error' || !data) return <CardError label="UV Index" detail={errorMsg} />;


  const level = uvLevel(data.uv);
  const cfg = uvConfig[level];
  const burnStr = formatBurnTime(data.burnMinutes);
  const maxTimeStr = formatMaxTime(data.uvMaxTime);
  
  const sun =
    latitude != null && longitude != null
      ? getSunInfoAt(latitude, longitude)
      : getSunInfo();
  const riseStr = sun.sunrise.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });
  const setStr = sun.sunset.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });
  
  const isNight = !sun.isDay;
  const progress = isNight ? 0 : Math.max(0, Math.min(100, sun.sunPosition * 100));
  const p = progress / 100;
  const sunY = 48 * Math.sqrt(1 - Math.pow(2 * p - 1, 2));

  const now = new Date().getTime();
  const msToSunset = sun.sunset.getTime() - now;
  let sunsetText = 'Sun has set';
  let isGoldenHour = false;
  if (sun.isDay && msToSunset > 0) {
    const hours = Math.floor(msToSunset / 3600000);
    const mins = Math.floor((msToSunset % 3600000) / 60000);

    if (msToSunset <= 45 * 60000) {
      isGoldenHour = true;
      sunsetText = `Golden Hour! Sunset in ${mins} min.`;
    } else if (hours === 0) {
      sunsetText = `Sunset in ${mins} min`;
    } else if (mins === 0) {
      sunsetText = `Sunset in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    } else {
      sunsetText = `Sunset in ${hours} ${hours === 1 ? 'hour' : 'hours'} and ${mins} min`;
    }
  }

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
                UV Index
              </p>
              <p className={`text-xl font-extrabold leading-tight ${cfg.labelColor}`}>
                {data.uv}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-white/60">
                Max: {data.uvMax} at {maxTimeStr}
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
        <div className="mt-auto flex flex-col gap-4 pt-2">
          <div>
            <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-white/40">
              Burn Time
            </p>
            <div className="flex items-start gap-2 min-h-[36px]">
              <span className={`mt-[3px] h-2 w-2 shrink-0 rounded-full ${cfg.dotColor}`} />
              <div>
                <p className={`text-sm font-bold leading-snug ${cfg.labelColor}`}>
                  Fair skin: {burnStr}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-white/45">
                  Ozone: {data.ozone} DU · Vit. D: Fast
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2 mt-1 border-t border-white/10">
            <div className="flex justify-between text-[10px] font-bold text-white/50 mb-1">
              <span className="flex flex-col items-center gap-1">
                <span>🌅</span>
                <span>{riseStr}</span>
              </span>
              <span className="flex flex-col items-center gap-1">
                <span>🌇</span>
                <span>{setStr}</span>
              </span>
            </div>
            
            <p className={`text-[9px] text-center font-bold mb-2 uppercase tracking-widest ${isGoldenHour ? 'text-amber-400' : 'text-slate-400'}`}>
              {sunsetText}
            </p>

            <div className="relative h-12 w-full flex items-end justify-center overflow-visible">
              <div className="absolute bottom-0 h-12 w-[80%] rounded-t-full border-t-2 border-l-2 border-r-2 border-dashed border-white/20" />
              {sun.isDay && (
                <div
                  className="absolute bottom-0 h-12 w-[80%] rounded-t-full border-t-2 border-l-2 border-r-2 border-amber-400"
                  style={{
                    clipPath: `inset(0 ${100 - progress}% 0 0)`,
                    transition: 'clip-path 1s ease-out'
                  }}
                />
              )}
              {sun.isDay && (
                <div 
                  className="absolute h-3 w-3 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,1)] z-10"
                  style={{
                    left: `calc(10% + ${progress * 0.8}% - 6px)`,
                    bottom: `calc(${sunY}px - 6px)`,
                    transition: 'left 1s ease-out, bottom 1s ease-out'
                  }}
                />
              )}
            </div>
            <div className="h-px w-full bg-white/20" />
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
          {detail ?? 'Check NEXT_PUBLIC_OPENUV_API_KEY in .env.local'}
        </p>
      </div>
    </div>
  );
}
