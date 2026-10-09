'use client';

import { useMemo } from 'react';
import {
  buildDailyVacationBrief,
  type BriefNowReading,
  type DailyVacationBrief as DailyVacationBriefModel,
  type PeriodSnapshot,
} from '../lib/daily-vacation-forecast';
import type { SammiDailyForecastViewRow } from '../lib/sammi-views';
import type { SamuiWeatherForecastRow } from '../lib/spire';
import SkyGlyph, { type SkyKind } from './SkyGlyph';

type DailyVacationBriefProps = {
  rows: SamuiWeatherForecastRow[];
  sammiDaily?: SammiDailyForecastViewRow | null;
  freshness?: { stale?: boolean; ageMinutes?: number | null; label?: string | null };
  /** Garden station. The paragraph’s Now clause only. */
  nowReading?: BriefNowReading | null;
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

function periodSkyKind(period: PeriodSnapshot): SkyKind {
  if ((period.thunderRiskPct ?? 0) >= 20) return 'storm';
  if ((period.rainRateMmH ?? 0) >= 0.5) return 'rain';
  if ((period.rainRateMmH ?? 0) >= 0.1 || (period.rainChancePct ?? 0) >= 35) return 'showers';
  if (period.id === 'evening' || period.id === 'tonight' || period.id === 'night') return 'moon';
  return 'sun';
}

function PeriodCard({ period }: { period: PeriodSnapshot }) {
  const kind = periodSkyKind(period);
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-extrabold text-white">
          <SkyGlyph kind={kind} size={16} />
          {period.label}
        </p>
        <p className="text-[9px] text-slate-500">{period.hourRange}</p>
      </div>
      <p className="mt-2 text-[13px] font-bold text-white">
        {fmtTemp(period.temp.min)}–{fmtTemp(period.temp.max)}°C
      </p>
      <p className="mt-1 text-[11px] text-sky-200">
        Highest chance {fmtPct(period.rainChancePct)}
      </p>
      <p className="mt-1 text-[10px] text-slate-400">
        Wind {fmtWind(period.windMs)}
        {period.rainRateMmH != null && period.rainRateMmH >= 0.05
          ? ` · rain ${fmtRate(period.rainRateMmH)}`
          : ''}
        {period.thunderRiskPct != null && period.thunderRiskPct >= 20
          ? ` · thunder ${fmtPct(period.thunderRiskPct)}`
          : ''}
      </p>
    </article>
  );
}

export default function DailyVacationBrief({
  rows,
  sammiDaily = null,
  freshness,
  nowReading = null,
}: DailyVacationBriefProps) {
  const brief = useMemo(
    () => buildDailyVacationBrief(rows, { sammiDaily, freshness, nowReading }),
    [rows, sammiDaily, freshness, nowReading],
  );

  const delayed = brief.confidence === 'stale';
  const notes = brief.conclusions.filter(
    (line) => line !== brief.confidenceNote && !/^Daytime rain chance peaks/.test(line),
  );

  return (
    <section className="rounded-3xl border border-cyan-400/20 bg-cyan-950/25 p-4 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">
            Coming up
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

      {delayed && brief.confidenceNote && (
        <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-100">
          {brief.confidenceNote}
        </p>
      )}

      {notes.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {notes.map((line) => (
            <li key={line} className="text-[13px] font-semibold leading-snug text-white">
              {line}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {brief.periods.map((period) => (
          <PeriodCard key={`${period.id}-${period.label}`} period={period} />
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
