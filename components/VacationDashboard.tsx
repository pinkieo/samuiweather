'use client';

import type { SamuiWeatherForecastRow } from '../lib/spire';
import {
  getBeachAdvice,
  getPM25Badge,
  getUVBadge,
} from '../lib/vacation';
import ForecastSlider from './ForecastSlider';

export type VacationDashboardProps = {
  rows: SamuiWeatherForecastRow[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
};

export default function VacationDashboard({
  rows,
  selectedIndex,
  onSelectedIndexChange,
}: VacationDashboardProps) {
  const row = rows[selectedIndex] ?? rows[0];
  if (!row) return null;

  const advice = getBeachAdvice(
    row.windSpeed,
    row.uvIndex,
    row.precipRate,
  );

  const uvBadge = getUVBadge(row.uvIndex);
  const aqBadge = getPM25Badge(row.pm25);

  const uvDisplay =
    row.uvIndex != null ? row.uvIndex.toFixed(1) : '—';
  const pmDisplay =
    row.pm25 != null ? Math.round(row.pm25).toString() : '—';

  const uvBarPct =
    row.uvIndex != null
      ? Math.min(100, Math.max(0, (row.uvIndex / 11) * 100))
      : 0;

  const aqi = row.aqi;
  const aqiWarn = aqi != null && aqi > 100;
  const aqiCritical = aqi != null && aqi > 150;

  return (
    <div className="mt-6 border-t border-white/10 pt-6">
      <h3 className="mb-3 text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">
        Vakantie-check
      </h3>

      <div
        className={`mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm ${advice.color}`}
      >
        <p className="font-black uppercase tracking-wide">{advice.label}</p>
        <p className="mt-1 text-[11px] font-medium text-slate-300">
          {advice.msg}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-inner">
          <div className="mb-2 flex items-start justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              UV-index
            </span>
            <span className={`text-xs ${uvBadge.tone}`}>
              {row.uvIndex != null ? `⚠ ${uvBadge.text}` : '—'}
            </span>
          </div>
          <p className="font-mono text-2xl">{uvDisplay}</p>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-yellow-400 to-rose-600 transition-all duration-300"
              style={{ width: `${uvBarPct}%` }}
            />
          </div>
          {row.uvIndex == null && (
            <p className="mt-2 text-[9px] text-slate-600">
              Solar-bundel niet actief of geen UV in response
            </p>
          )}
        </div>

        <div
          className={`rounded-2xl border border-white/10 bg-white/5 p-4 shadow-inner transition-shadow duration-300 ${
            aqiCritical
              ? 'animate-pulse ring-2 ring-rose-500/70 shadow-[0_0_28px_rgba(244,63,94,0.35)]'
              : aqiWarn
                ? 'ring-2 ring-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
                : ''
          }`}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Luchtkwaliteit
            </span>
            <span className={`shrink-0 text-xs ${aqBadge.tone}`}>
              {aqBadge.text}
            </span>
          </div>
          <p className="font-mono text-2xl">{pmDisplay}</p>
          <p className="mt-1 text-[9px] uppercase text-slate-500">
            PM2.5 (haze / smog)
          </p>
          {aqi != null && (
            <p className="mt-2 font-mono text-lg leading-tight text-slate-100">
              AQI{' '}
              <span
                className={
                  aqiCritical
                    ? 'text-rose-400'
                    : aqiWarn
                      ? 'text-amber-400'
                      : 'text-emerald-400/90'
                }
              >
                {aqi}
              </span>
            </p>
          )}
          {row.aqiStatus && selectedIndex === 0 && (
            <p
              className={`mt-1 text-[11px] font-semibold leading-snug ${
                aqiCritical
                  ? 'text-rose-300'
                  : aqiWarn
                    ? 'text-amber-200/90'
                    : 'text-slate-400'
              }`}
            >
              {row.aqiStatus}
            </p>
          )}
          {row.station && selectedIndex === 0 && (
            <p className="mt-1 truncate text-[9px] text-slate-600">
              {row.station}
            </p>
          )}
          {row.pm25 == null && selectedIndex !== 0 && (
            <p className="mt-2 text-[9px] text-slate-600">
              Geen PM2.5 in dit uur — schuif naar &apos;nu&apos; voor WAQI
            </p>
          )}
          {row.pm25 == null && selectedIndex === 0 && !aqi && (
            <p className="mt-2 text-[9px] text-slate-600">
              Geen WAQI — zet WAQI_API_TOKEN
            </p>
          )}
        </div>
      </div>

      <ForecastSlider
        rows={rows}
        value={selectedIndex}
        onChange={onSelectedIndexChange}
      />
    </div>
  );
}
