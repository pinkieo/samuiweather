'use client';

import { useEffect, useState } from 'react';
import type { ForecastOverview, OverviewSlotView } from '@/lib/forecast-overview';

function fmt(n: number | null | undefined, d = 0, s = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(d)}${s}`;
}

function SlotRow({ view, current }: { view: OverviewSlotView; current: boolean }) {
  const acc = view.accuracy;
  return (
    <li
      className={[
        'rounded-xl border px-3 py-2',
        current ? 'border-cyan-400/35 bg-cyan-950/40' : 'border-white/10 bg-white/[0.03]',
      ].join(' ')}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-extrabold text-white">
          {view.slot.slice(0, 2)}:00{' '}
          <span className="font-semibold text-slate-400">{view.label}</span>
        </p>
        <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
          {view.locked ? 'locked' : view.liveFallback ? 'live' : 'open'}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-200">
        {fmt(view.tempMinC)}–{fmt(view.tempMaxC)}°C · wind {fmt(view.windMaxMs, 1, ' m/s')} · chance of
        rain {fmt(view.pop1hMaxPct, 0, '%')} · thunder {fmt(view.thunderMaxPct, 0, '%')} · fog{' '}
        {fmt(view.fogMaxPct, 0, '%')}
      </p>
      <p className="mt-0.5 text-[10px] text-amber-100/80">
        Rain {fmt(view.precipSumMm, 1, ' mm')} uncalibrated
        {acc
          ? ` · station Δ ${fmt(acc.stationRainDeltaMm, 1, ' mm')} · temp error ${fmt(acc.tempMeanErrorC, 1, '°C')}`
          : ' · not scored yet'}
      </p>
    </li>
  );
}

export default function DailyForecastChecks() {
  const [data, setData] = useState<ForecastOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/forecast/overview', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ForecastOverview | null) => {
        if (!cancelled && d) setData(d);
      })
      .catch(() => {
        /* card stays empty if overview is down */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;

  return (
    <section className="mb-3 rounded-2xl border border-cyan-400/20 bg-cyan-950/20 px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[9px] font-black uppercase tracking-widest text-cyan-300">
          Today&apos;s 4 checks
        </p>
        <a href="/overview" className="text-[10px] font-semibold text-cyan-200/80 hover:underline">
          Full overview
        </a>
      </div>
      <ul className="space-y-1.5">
        {data.slots.map((slot) => (
          <SlotRow
            key={slot.slot}
            view={slot}
            current={slot.date === data.current.date && slot.slot === data.current.slot}
          />
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-snug text-slate-500">{data.rainSkillNote}</p>
    </section>
  );
}
