'use client';

import { useMemo } from 'react';
import {
  buildDailyVacationBrief,
  rainIntensityForDisplay,
  type DailyVacationBrief as DailyVacationBriefModel,
  type PeriodSnapshot,
} from '../lib/daily-vacation-forecast';
import type { SammiDailyForecastViewRow } from '../lib/sammi-views';
import type { SamuiWeatherForecastRow } from '../lib/spire';

type DailyVacationBriefProps = {
  rows: SamuiWeatherForecastRow[];
  sammiDaily?: SammiDailyForecastViewRow | null;
  freshness?: { stale?: boolean; ageMinutes?: number | null; label?: string | null };
};

const verdictClasses: Record<DailyVacationBriefModel['verdict'], string> = {
  'Beach-first': 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100',
  'Flexible day': 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100',
  'Rain-aware day': 'border-amber-400/30 bg-amber-500/10 text-amber-100',
  'Indoor-first': 'border-rose-400/30 bg-rose-500/10 text-rose-100',
};

function fmtTemp(n: number | null): string {
  return n == null || !Number.isFinite(n) ? '—' : `${Math.round(n)}`;
}

function fmtPct(n: number | null): string {
  return n == null || !Number.isFinite(n) ? '—' : `${Math.round(n)}%`;
}

function fmtWind(n: number | null): string {
  return n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(1)} m/s`;
}

function fmtRate(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n < 0.05) return 'dry';
  return `${n.toFixed(1)} mm/h`;
}

function PeriodCard({ period }: { period: PeriodSnapshot }) {
  const thin = period.hoursAvailable === 0;
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-extrabold text-white">{period.label}</p>
        <p className="text-[9px] text-slate-500">{period.hourRange}</p>
      </div>
      {thin ? (
        <p className="mt-2 text-[11px] text-slate-400">No hourly data for this window.</p>
      ) : (
        <>
          <p className="mt-1.5 text-[11px] leading-snug text-white/80">{period.summary}</p>
          <p className="mt-2 text-[10px] text-slate-400">
            {fmtTemp(period.temp.min)}–{fmtTemp(period.temp.max)}°C
            {' · '}rain {fmtPct(period.rainChancePct)}
            {' · '}{fmtRate(period.rainRateMmH)}
            {' · '}wind {fmtWind(period.windMs)}
            {period.thunderRiskPct != null && period.thunderRiskPct >= 20
              ? ` · thunder ${fmtPct(period.thunderRiskPct)}`
              : ''}
          </p>
        </>
      )}
    </article>
  );
}

export default function DailyVacationBrief({
  rows,
  sammiDaily = null,
  freshness,
}: DailyVacationBriefProps) {
  const brief = useMemo(
    () => buildDailyVacationBrief(rows, { sammiDaily, freshness }),
    [rows, sammiDaily, freshness],
  );

  const intensity = rainIntensityForDisplay(brief.rainRateMmH);
  const degraded = brief.confidence !== 'ok';

  return (
    <section className="rounded-3xl border border-cyan-400/20 bg-cyan-950/25 p-4 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">
            Today in Koh Samui
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            {brief.dateLabel}
            {brief.freshnessLabel ? ` · forecast ${brief.freshnessLabel}` : ''}
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wide ${verdictClasses[brief.verdict]}`}
        >
          {brief.verdict}
        </span>
      </div>

      {degraded && (
        <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-100">
          {brief.confidenceNote}
        </p>
      )}

      <ol className="mt-3 space-y-1.5">
        {brief.conclusions.map((line, i) => (
          <li key={`${i}-${line}`} className="flex gap-2 text-[13px] font-semibold leading-snug text-white">
            <span className="mt-0.5 text-[10px] font-black text-cyan-300">{i + 1}</span>
            <span>{line}</span>
          </li>
        ))}
      </ol>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
        <div className="rounded-xl bg-white/5 px-3 py-2">
          <p className="text-slate-500">Temperature</p>
          <p className="mt-1 font-bold text-white">
            {fmtTemp(brief.temperature.min)}–{fmtTemp(brief.temperature.max)}°C
          </p>
        </div>
        <div className="rounded-xl bg-white/5 px-3 py-2">
          <p className="text-slate-500">Rain chance</p>
          <p className="mt-1 font-bold text-white">{fmtPct(brief.rainChancePct)}</p>
        </div>
        <div className="rounded-xl bg-white/5 px-3 py-2">
          <p className="text-slate-500">Rain intensity</p>
          <p className="mt-1 font-bold text-white">
            {intensity ? `${intensity} · ${fmtRate(brief.rainRateMmH)}` : fmtRate(brief.rainRateMmH)}
          </p>
        </div>
        <div className="rounded-xl bg-white/5 px-3 py-2">
          <p className="text-slate-500">Wind / thunder</p>
          <p className="mt-1 font-bold text-white">
            {fmtWind(brief.windMs)}
            {brief.thunderRiskPct != null ? ` · ${fmtPct(brief.thunderRiskPct)}` : ''}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {brief.periods.map((period) => (
          <PeriodCard key={period.id} period={period} />
        ))}
      </div>

      {(brief.fog.relevant || brief.ceiling.relevant) && (
        <div className="mt-2 space-y-1 text-[11px] text-slate-300">
          {brief.fog.text && <p>{brief.fog.text}</p>}
          {brief.ceiling.text && <p>{brief.ceiling.text}</p>}
        </div>
      )}

      {brief.confidence === 'ok' && (brief.windows.heat || brief.windows.wind) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
          {brief.windows.heat && <span>{brief.windows.heat.text}</span>}
          {brief.windows.wind && <span>{brief.windows.wind.text}</span>}
        </div>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-white/75">{brief.summary}</p>
      <p className="mt-2 text-[9px] text-slate-500">{brief.sourceLine}.</p>
    </section>
  );
}
