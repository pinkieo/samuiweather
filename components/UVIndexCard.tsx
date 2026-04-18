'use client';

import React, { useEffect, useState } from 'react';
import type { UVData } from '../app/api/uvindex/route';
import { getSunInfo, getSunInfoAt } from '../lib/sun';
import { formatWindMs } from '../lib/spire';
import { getWindInfo } from '../lib/vacation';
import WindCompass from './WindCompass';

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
  /** Spire surface wind (m/s) — same instant as dashboard “Weather Now” when passed from forecast row */
  windSpeedMs,
  windDirDeg,
}: {
  latitude?: number;
  longitude?: number;
  windSpeedMs?: number | null;
  windDirDeg?: number | null;
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

  const hasWind =
    windSpeedMs != null &&
    Number.isFinite(windSpeedMs) &&
    windDirDeg != null &&
    Number.isFinite(windDirDeg);

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
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-white/40">
            Burn Time
          </p>
          <div className="flex min-h-[36px] items-start gap-2">
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

        <div className="mt-4 rounded-2xl border border-white/12 bg-black/30 p-3 shadow-inner">
          <p className="mb-3 text-[9px] font-black uppercase tracking-widest text-white/35">
            UV · wind · sun path
          </p>

          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl ring-1 ${cfg.iconRing} select-none`}
                aria-hidden
              >
                {cfg.icon}
              </span>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-white/40">UV Index</p>
                <p className={`text-2xl font-extrabold leading-none ${cfg.labelColor}`}>{data.uv}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-white/55">
                  Max {data.uvMax} at {maxTimeStr}
                </p>
                <p className={`mt-0.5 text-[10px] font-bold ${cfg.labelColor}`}>{cfg.label}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-l border-white/10 pl-3">
              {hasWind ? (
                <>
                  <WindCompass direction={windDirDeg!} size={36} />
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-white/40">Wind</p>
                    <p className="text-sm font-bold leading-tight text-white">
                      {formatWindMs(windSpeedMs!)}{' '}
                      <span className="text-[11px] font-semibold text-white/45">m/s</span>
                    </p>
                    <p className="text-[11px] font-semibold text-cyan-200/90">
                      {getWindInfo(windDirDeg!).dir}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-[10px] text-white/45">Wind —</p>
              )}
            </div>
          </div>

          <div className="mt-3 flex justify-between text-[10px] font-bold text-white/50">
            <span className="flex flex-col items-center gap-1">
              <span>🌅</span>
              <span>{riseStr}</span>
            </span>
            <span className="flex flex-col items-center gap-1">
              <span>🌇</span>
              <span>{setStr}</span>
            </span>
          </div>

          <p
            className={`mb-2 mt-2 text-center text-[9px] font-bold uppercase tracking-widest ${
              isGoldenHour ? 'text-amber-400' : 'text-slate-400'
            }`}
          >
            {sunsetText}
          </p>

          <div className="relative flex h-12 w-full items-end justify-center overflow-visible">
            <div className="absolute bottom-0 h-12 w-[80%] rounded-t-full border-l-2 border-r-2 border-t-2 border-dashed border-white/20" />
            {sun.isDay && (
              <div
                className="absolute bottom-0 h-12 w-[80%] rounded-t-full border-l-2 border-r-2 border-t-2 border-amber-400"
                style={{
                  clipPath: `inset(0 ${100 - progress}% 0 0)`,
                  transition: 'clip-path 1s ease-out',
                }}
              />
            )}
            {sun.isDay && (
              <div
                className="absolute z-10 h-3 w-3 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,1)]"
                style={{
                  left: `calc(10% + ${progress * 0.8}% - 6px)`,
                  bottom: `calc(${sunY}px - 6px)`,
                  transition: 'left 1s ease-out, bottom 1s ease-out',
                }}
              />
            )}
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
