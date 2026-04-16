'use client';

import React from 'react';
import type { BeachAdviseStatus, NextTideExtremum, TideTrend } from '../lib/tides';
import {
  beachAdviseLabels,
  explainTideHeightMsl,
  getBeachAdvise,
} from '../lib/tides';

function tidePhase(trend: TideTrend): { title: string; sub: string } {
  if (trend === 'rising') {
    return { title: 'Flood tide — water rising', sub: 'The sea is coming in.' };
  }
  if (trend === 'falling') {
    return { title: 'Ebb tide — water falling', sub: 'The sea is going out.' };
  }
  if (trend === 'steady') {
    return { title: 'Slack tide', sub: 'Around high or low water — turning.' };
  }
  return { title: 'Tide trend unknown', sub: 'Not enough data to infer direction.' };
}

function formatHoursUntil(whenMs: number): string {
  const h = Math.max(0, (whenMs - Date.now()) / 3600000);
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${Math.round(h / 24)} d`;
}

function nextEventLabel(x: NextTideExtremum): string {
  const isHigh = x.kind === 'high';
  const kind = isHigh ? 'High water' : 'Low water';
  return `${kind} in ~${formatHoursUntil(x.whenMs)}`;
}

const beachStatusConfig: Record<
  BeachAdviseStatus,
  { dot: string; statusColor: string }
> = {
  wide_beach: { dot: 'bg-teal-400', statusColor: 'text-teal-300' },
  beach_disappearing: { dot: 'bg-amber-400', statusColor: 'text-amber-300' },
  deep_water: { dot: 'bg-rose-400', statusColor: 'text-rose-300' },
  neutral: { dot: 'bg-slate-500', statusColor: 'text-slate-400' },
};

function beachStatusLabel(status: BeachAdviseStatus): string {
  if (status === 'neutral') return 'Normal beach';
  return beachAdviseLabels[status].title;
}

interface TideCardProps {
  trend: TideTrend;
  heightM: number | null;
  nextExtremum?: NextTideExtremum | null;
}

export default function TideCard({ trend, heightM, nextExtremum }: TideCardProps) {
  const phase = tidePhase(trend);
  const beachStatus = getBeachAdvise(trend, heightM);
  const beach = beachStatusConfig[beachStatus];
  const beachLabel = beachStatusLabel(beachStatus);
  const beachHint =
    beachStatus !== 'neutral' ? beachAdviseLabels[beachStatus].hint : null;

  const heightExplain =
    heightM != null && !Number.isNaN(heightM)
      ? explainTideHeightMsl(heightM)
      : null;

  const rawStr =
    heightM != null && !Number.isNaN(heightM)
      ? `${heightM >= 0 ? '+' : ''}${heightM.toFixed(2)} m vs MSL`
      : null;

  return (
    <div
      className="
        relative w-full overflow-hidden rounded-3xl border border-cyan-500/25
        bg-gradient-to-br from-slate-900/90 via-slate-900/80 to-cyan-950/40
        shadow-[0_4px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl
      "
    >
      <div className="pointer-events-none absolute -left-10 top-0 h-full w-24 rotate-12 bg-white/[0.025]" />

      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/15 text-2xl ring-1 ring-cyan-400/30"
              aria-hidden
            >
              🌊
            </span>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-white/40">
                Tide now
              </p>
              <p className="text-lg font-extrabold leading-tight text-cyan-100">
                {phase.title}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-white/50">
                {phase.sub}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-white/35">
            Water level (Spire vs mean sea level)
          </p>
          {rawStr && (
            <p className="mt-1 font-mono text-sm font-bold text-white">{rawStr}</p>
          )}
          {heightExplain && (
            <p className="mt-1 text-[11px] leading-snug text-white/70">{heightExplain}</p>
          )}
          {!heightM && !heightExplain && (
            <p className="mt-1 text-[11px] text-slate-500">No height data</p>
          )}
        </div>

        {nextExtremum && (
          <p className="mt-3 text-[11px] font-semibold leading-snug text-amber-200/90">
            → Next: {nextEventLabel(nextExtremum)}
          </p>
        )}

        <div className="my-3 h-px bg-white/8" />

        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-white/40">
            Beach
          </p>
          <div className="flex min-h-[36px] items-start gap-2">
            <span className={`mt-[3px] h-2 w-2 shrink-0 rounded-full ${beach.dot}`} />
            <div>
              <p className={`text-sm font-bold leading-snug ${beach.statusColor}`}>
                {beachLabel}
              </p>
              {beachHint && (
                <p className="mt-0.5 text-[10px] leading-snug text-white/45">
                  {beachHint}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
