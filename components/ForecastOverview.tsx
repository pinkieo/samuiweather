'use client';

import { useEffect, useState } from 'react';
import type { ForecastOverview, OverviewSlotView, SlotAccuracy } from '@/lib/forecast-overview';

function fmt(n: number | null | undefined, digits = 1, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
}

function AccuracyTable({ acc }: { acc: SlotAccuracy }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12px] text-slate-200">
        <thead className="text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1 pr-3 font-semibold">Field</th>
            <th className="py-1 pr-3 font-semibold">Station</th>
            <th className="py-1 pr-3 font-semibold">This issuance</th>
            <th className="py-1 font-semibold">Spire − station</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-white/10">
            <td className="py-1.5 pr-3">Temp mean</td>
            <td className="pr-3">{fmt(acc.stationTempMeanC, 1, '°C')}</td>
            <td className="pr-3">{fmt(acc.forecastTempMeanC, 1, '°C')}</td>
            <td>{fmt(acc.tempMeanErrorC, 1, '°C')}</td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="py-1.5 pr-3">Temp min / max</td>
            <td className="pr-3">
              {fmt(acc.stationTempMinC, 1)} / {fmt(acc.stationTempMaxC, 1)}°C
            </td>
            <td className="pr-3">
              {fmt(acc.forecastTempMinC, 1)} / {fmt(acc.forecastTempMaxC, 1)}°C
            </td>
            <td>—</td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="py-1.5 pr-3">Rain (mm)</td>
            <td className="pr-3">
              Δ {fmt(acc.stationRainDeltaMm, 1, ' mm')} · end-of-window day counter{' '}
              {fmt(acc.stationRainDayMmEnd, 1, ' mm')}
            </td>
            <td className="pr-3">sum of hourly rate {fmt(acc.forecastPrecipSumMm, 1, ' mm')}</td>
            <td>
              {acc.forecastPrecipSumMm != null && acc.stationRainDeltaMm != null
                ? fmt(acc.forecastPrecipSumMm - acc.stationRainDeltaMm, 1, ' mm')
                : '—'}
            </td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="py-1.5 pr-3">Rain rate max / chance</td>
            <td className="pr-3">{fmt(acc.stationRainRateMaxMmh, 1, ' mm/h')}</td>
            <td className="pr-3">
              chance of rain mean {fmt(acc.forecastPop1hMeanPct, 0, '%')} · max{' '}
              {fmt(acc.forecastPop1hMaxPct, 0, '%')}
            </td>
            <td>—</td>
          </tr>
          <tr className="border-t border-white/10">
            <td className="py-1.5 pr-3">Thunder</td>
            <td className="pr-3">Not measured at the backyard station</td>
            <td className="pr-3">{fmt(acc.forecastThunderMeanPct, 0, '%')}</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-snug text-amber-100/90">{acc.rainSkillNote}</p>
      <p className="mt-1 text-[10px] text-slate-500">
        {acc.stationSampleCount} station minutes · window {acc.windowStartUtc} → {acc.windowEndUtc}
      </p>
    </div>
  );
}

function SlotCard({
  view,
  active,
}: {
  view: OverviewSlotView;
  active: boolean;
}) {
  return (
    <article
      className={[
        'rounded-2xl border p-4',
        active ? 'border-cyan-400/40 bg-cyan-950/30' : 'border-white/10 bg-white/[0.03]',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">{view.label}</p>
          <p className="text-[11px] text-slate-400">{view.slotStartIct} ICT</p>
        </div>
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-300">
          {view.locked ? 'Locked' : view.liveFallback ? 'Live rolling' : 'No snapshot'}
        </span>
      </div>
      <p className="mt-3 text-sm font-medium leading-snug text-white">{view.tourist.headline}</p>
      <p className="mt-2 text-[12px] text-slate-300">
        {fmt(view.tempMinC, 0)}–{fmt(view.tempMaxC, 0)}°C · chance of rain max {fmt(view.pop1hMaxPct, 0, '%')} ·
        thunder max {fmt(view.thunderMaxPct, 0, '%')}
      </p>
      <ul className="mt-3 space-y-2">
        {view.tourist.periods.map((p) => (
          <li key={p.label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-[11px] font-bold text-white">
              {p.label}{' '}
              <span className="font-medium text-slate-500">{p.hourRange}</span>
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-slate-200">{p.text}</p>
          </li>
        ))}
      </ul>
      {view.accuracy && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Vs Baan Ton Kluay (this slot)
          </p>
          <AccuracyTable acc={view.accuracy} />
        </div>
      )}
      <p className="mt-3 text-[10px] text-slate-500">
        Issuance {view.issuanceTimeUtc ?? '—'} · OPF overlay {view.opfOverlayApplied ? 'yes' : 'no'} · lead{' '}
        {fmt(view.leadHoursMin, 0)}–{fmt(view.leadHoursMax, 0)} h · {view.hourCount} hours
      </p>
    </article>
  );
}

export default function ForecastOverview() {
  const [data, setData] = useState<ForecastOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/forecast/overview', { cache: 'no-store' })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
        return json as ForecastOverview;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        {error}
      </p>
    );
  }
  if (!data) {
    return <p className="text-sm text-slate-400">Loading locked issuances…</p>;
  }

  const activeKey = `${data.current.date}-${data.current.slot}`;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300">
          Koh Samui · 4× daily
        </p>
        <h1 className="text-2xl font-extrabold text-white">Spire OPF vs the backyard</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-300">
          Each lock is the Spire Standard Point plus Optimized Point probabilities as stored at 00:00,
          06:00, 12:00 and 18:00 ICT. RainViewer is live rain on the map — not this page. Ecowitt at Baan
          Ton Kluay is ground truth.
        </p>
        {data.now && (
          <p className="text-[12px] text-slate-400">
            Station now {fmt(data.now.tempC, 1, '°C')} · rain rate {fmt(data.now.rainRateMmh, 1, ' mm/h')} ·
            today&apos;s rain counter {fmt(data.now.rainDayMm, 1, ' mm')}
          </p>
        )}
      </header>

      {data.previousAccuracy && (
        <section className="rounded-2xl border border-amber-400/25 bg-amber-950/20 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-200">
            Previous slot · {data.previous.slot} {data.previous.date}
          </p>
          <AccuracyTable acc={data.previousAccuracy} />
        </section>
      )}

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Rolling ICT day</p>
        <p className="mt-2 text-sm text-white">
          {data.rollingDay.date}
          {data.rollingDay.complete ? '' : ' (in progress)'} · station {fmt(data.rollingDay.stationTempMinC, 1)}–
          {fmt(data.rollingDay.stationTempMaxC, 1)}°C · rain day counter{' '}
          {fmt(data.rollingDay.stationRainDayMm, 1, ' mm')} · {data.rollingDay.stationSampleCount} minutes
        </p>
        <p className="mt-2 text-[12px] leading-snug text-amber-100/80">{data.rainSkillNote}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.slots.map((slot) => (
          <SlotCard
            key={`${slot.date}-${slot.slot}`}
            view={slot}
            active={`${data.current.date}-${slot.slot}` === activeKey && slot.date === data.current.date}
          />
        ))}
      </div>
    </div>
  );
}
