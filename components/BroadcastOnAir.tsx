'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BroadcastLatest } from '@/lib/broadcast-catalog';

export default function BroadcastOnAir({ variant }: { variant: 'chip' | 'drawer' }) {
  const [latest, setLatest] = useState<BroadcastLatest | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/broadcast/latest', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BroadcastLatest | null) => {
        if (!cancelled && d) setLatest(d);
      })
      .catch(() => {
        /* chip stays hidden if the catalog is down */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!latest?.feature && !latest?.hourly) return null;

  const delayed = latest.delayed;
  const title = latest.feature?.lowerThird.title ?? 'Sammi on air';
  const clock = latest.feature
    ? new Date(latest.feature.publishedAt).toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  if (variant === 'chip') {
    return (
      <Link
        href="/broadcast"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-red-400/40 bg-slate-950/90 px-3 py-1.5 shadow-xl backdrop-blur-md"
        title="Sammi on air"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        <span className="text-[10px] font-black uppercase tracking-widest text-red-200">On air</span>
        {delayed && <span className="text-[9px] font-bold uppercase text-amber-200/90">Delayed</span>}
      </Link>
    );
  }

  return (
    <Link
      href="/broadcast"
      className="mb-3 block rounded-xl border border-red-400/20 bg-white/5 px-4 py-3 transition hover:bg-white/10"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-black uppercase tracking-widest text-red-300">
          Sammi on air
        </span>
        {delayed ? (
          <span className="text-[9px] font-bold uppercase text-amber-200">Delayed</span>
        ) : (
          <span className="text-[9px] tabular-nums text-slate-500">{clock} ICT</span>
        )}
      </div>
      <p className="mt-1 truncate text-[11px] font-semibold text-white/85">{title}</p>
      {latest.feature?.lowerThird.subtitle && (
        <p className="mt-0.5 truncate text-[10px] text-slate-400">{latest.feature.lowerThird.subtitle}</p>
      )}
    </Link>
  );
}
