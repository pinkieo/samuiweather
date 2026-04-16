'use client';

import React from 'react';
import type { SourceFreshness } from '../lib/data-freshness';

interface Props {
  label: string;       // e.g. "Airport sensors"
  icon: string;        // e.g. "✈️"
  freshness: SourceFreshness;
  showSyncTime?: boolean;
}

export default function DataFreshnessBadge({ label, icon, freshness, showSyncTime = true }: Props) {
  const { ageMinutes, isStale, label: ageLabel, syncTimeIct } = freshness;

  const color = isStale
    ? 'border-amber-500/30 bg-amber-500/8 text-amber-300'
    : ageMinutes < 5
    ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-300'
    : 'border-white/10 bg-white/5 text-slate-400';

  const dot = isStale ? 'bg-amber-400 animate-pulse' : ageMinutes < 10 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500';

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${color}`}>
      <span className="text-xs">{icon}</span>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
        </div>
        <span className="text-[9px] leading-none opacity-70">
          {showSyncTime ? `${syncTimeIct} ICT · ` : ''}{ageLabel}
          {isStale ? ' ⚠️' : ''}
        </span>
      </div>
    </div>
  );
}

/** Compact inline version for tight spaces */
export function FreshnessChip({ icon, ageLabel, isStale, syncTimeIct }: {
  icon: string;
  ageLabel: string;
  isStale: boolean;
  syncTimeIct: string;
}) {
  const color = isStale
    ? 'text-amber-400'
    : 'text-slate-500';
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-mono ${color}`} title={`Last sync: ${syncTimeIct} ICT`}>
      <span>{icon}</span>
      <span>{isStale ? '⚠️ ' : ''}{syncTimeIct} · {ageLabel}</span>
    </span>
  );
}
