'use client';

import type { SamuiWeatherForecastRow } from '../lib/spire';

const MAX_HOURS = 24;

export type ForecastSliderProps = {
  rows: SamuiWeatherForecastRow[];
  value: number;
  onChange: (index: number) => void;
};

function formatTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

export default function ForecastSlider({
  rows,
  value,
  onChange,
}: ForecastSliderProps) {
  const slice = rows.slice(0, MAX_HOURS);
  const max = Math.max(0, slice.length - 1);
  const safe = Math.min(Math.max(0, value), max);

  if (slice.length < 2) {
    return (
      <p className="text-[10px] text-slate-500">
        Geen uurlijkse reeks — slider niet beschikbaar.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          Buien-timer (24 u)
        </span>
        <span className="font-mono text-[11px] text-cyan-400/90">
          {formatTimeLabel(slice[safe]?.time ?? '')}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={safe}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-cyan-500"
        aria-label="Forecast-tijd"
      />
      <div className="flex justify-between text-[9px] text-slate-600">
        <span>{formatTimeLabel(slice[0]?.time ?? '')}</span>
        <span>{formatTimeLabel(slice[max]?.time ?? '')}</span>
      </div>
    </div>
  );
}
