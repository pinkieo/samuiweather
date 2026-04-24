'use client';

import { Sun, Wind } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatTempC, type SamuiWeatherForecastRow } from '../lib/spire';
import { rainChancePercentForRow } from '../lib/sammi-views';
import { getSunInfo } from '../lib/sun';
import WindCompass from './WindCompass';

interface HourlyForecastProps {
  rows: SamuiWeatherForecastRow[];
  /** Index in `rows` — matches Sammi / Weather Now. The tile with this index gets the expanded layout. */
  selectedIndex?: number;
  onHourSelect?: (indexInRows: number) => void;
}

const TZ = 'Asia/Bangkok';

/** Meteorological wind direction (0–360°) → compass label (same 16 sectors as elsewhere). */
const WIND_DIR_LABELS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

function windDirLabel(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  const i = Math.round(d / 22.5) % 16;
  return WIND_DIR_LABELS[i] ?? '—';
}

function windSpeedKmh(ms: number): number {
  return Math.round(ms * 3.6 * 10) / 10;
}

function bangkokDateKey(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '';
  }
}

/** Bangkok date+hour — for “is this the current hour?” */
function bangkokHourKey(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
}

function isSameBangkokHourAsNow(iso: string): boolean {
  return bangkokHourKey(iso) === bangkokHourKey(new Date());
}

/** Hourly steps for the current calendar day (Bangkok), with original index in `rows` for selectedIndex sync. */
function todayHourlyWithIndices(
  rows: SamuiWeatherForecastRow[],
): { row: SamuiWeatherForecastRow; index: number }[] {
  const todayKey = new Date().toLocaleDateString('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const out: { row: SamuiWeatherForecastRow; index: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (bangkokDateKey(row.time) === todayKey) {
      out.push({ row, index: i });
    }
  }
  if (out.length > 0) return out;
  return rows.slice(0, 24).map((row, i) => ({ row, index: i }));
}

export function HourlyScrollStrip({
  scrollKey,
  dense,
  children,
}: {
  scrollKey: number;
  /** Tighter bottom padding (daily expander). */
  dense?: boolean;
  children: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollHints = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const max = scrollWidth - clientWidth;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(max > 4 && scrollLeft < max - 4);
  }, []);

  useEffect(() => {
    updateScrollHints();
  }, [scrollKey, updateScrollHints]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => updateScrollHints());
    ro.observe(el);
    el.addEventListener('scroll', updateScrollHints, { passive: true });
    window.addEventListener('resize', updateScrollHints);
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', updateScrollHints);
      window.removeEventListener('resize', updateScrollHints);
    };
  }, [updateScrollHints]);

  const scrollByPage = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const step = Math.min(280, Math.max(160, el.clientWidth * 0.55));
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  const pb = dense ? 'pb-1' : 'pb-4';

  return (
    <div className="relative">
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollByPage(-1)}
          className="absolute left-0 top-1/2 z-10 flex h-16 w-7 -translate-y-1/2 items-center justify-center rounded-r-lg border border-white/15 bg-slate-950/95 text-lg font-bold text-cyan-300 shadow-lg backdrop-blur-sm transition hover:bg-slate-900/95 hover:text-white"
          aria-label="Earlier hours"
        >
          ‹
        </button>
      )}
      {canScrollRight && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-10 bg-gradient-to-l from-slate-950 via-slate-950/80 to-transparent"
            aria-hidden
          />
          <button
            type="button"
            onClick={() => scrollByPage(1)}
            className="absolute right-0 top-1/2 z-10 flex h-16 w-7 -translate-y-1/2 items-center justify-center rounded-l-lg border border-white/15 bg-slate-950/95 text-lg font-bold text-cyan-300 shadow-lg backdrop-blur-sm transition hover:bg-slate-900/95 hover:text-white"
            aria-label="Later hours"
          >
            ›
          </button>
        </>
      )}

      <div
        ref={scrollRef}
        className={[
          'flex w-full snap-x snap-mandatory gap-2 overflow-x-auto pt-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
          pb,
          canScrollLeft ? 'pl-7 sm:pl-8' : 'pl-1',
          canScrollRight ? 'pr-7 sm:pr-8' : 'pr-1',
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  );
}

export default function HourlyForecast({ rows, selectedIndex, onHourSelect }: HourlyForecastProps) {
  const hourlyEntries = todayHourlyWithIndices(rows);
  const selectedMatchIdx =
    selectedIndex === undefined ? -1 : hourlyEntries.findIndex((e) => e.index === selectedIndex);
  const isExpandedSlot = (i: number) => {
    if (selectedIndex === undefined) return i === 0;
    if (selectedMatchIdx >= 0) return i === selectedMatchIdx;
    return i === 0;
  };

  const sunInfo = getSunInfo();
  const sunsetMs = sunInfo.sunset.getTime();
  const sunsetInsertAfter = hourlyEntries.findIndex(({ row }, i) => {
    const curr = new Date(row.time).getTime();
    const next = hourlyEntries[i + 1] ? new Date(hourlyEntries[i + 1].row.time).getTime() : Infinity;
    return curr <= sunsetMs && sunsetMs < next;
  });

  return (
    <div className="w-full">
      <HourlyScrollStrip scrollKey={hourlyEntries.length}>
          {hourlyEntries.map(({ row, index: rowIndex }, i) => {
            const d = new Date(row.time);
            const timeStr = d.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZone: 'Asia/Bangkok',
            });
            const expanded = isExpandedSlot(i);
            const expandedHeaderLabel = isSameBangkokHourAsNow(row.time) ? 'NOW' : timeStr;

            const pop = rainChancePercentForRow(row);
            const showPop = pop >= 10;

            const sun = getSunInfo(d);
            const isDay = sun.isDay;

            let Icon = isDay ? '☀️' : '🌙';
            if (row.precipRate > 0.5) Icon = '🌧️';
            else if (row.precipRate > 0.1) Icon = '🌦️';
            else if (row.cloudCover > 60) Icon = '☁️';
            else if (row.cloudCover > 20) Icon = isDay ? '⛅' : '☁️';

            const showSunsetAfter = i === sunsetInsertAfter;

            return (
              <React.Fragment key={`${row.time}-${rowIndex}`}>
                <div
                  role={onHourSelect ? 'button' : undefined}
                  tabIndex={onHourSelect ? 0 : undefined}
                  onClick={onHourSelect ? () => onHourSelect(rowIndex) : undefined}
                  onKeyDown={
                    onHourSelect
                      ? (ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            onHourSelect(rowIndex);
                          }
                        }
                      : undefined
                  }
                  className={`flex shrink-0 snap-center flex-col rounded-full px-3 py-3 ${
                    expanded
                      ? 'min-w-[10.25rem] items-stretch bg-white/10 ring-1 ring-white/20'
                      : 'min-w-[60px] items-center justify-between'
                  } ${onHourSelect ? 'cursor-pointer touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50' : ''}`}
                >
                  {expanded ? (
                    <>
                      <span className="text-center text-[10px] font-bold text-white">{expandedHeaderLabel}</span>
                      <div className="mt-1 grid w-full grid-cols-2 gap-x-2 gap-y-1.5">
                        <div className="flex flex-col items-center justify-center">
                          {showPop && (
                            <span className="mb-0.5 text-[9px] font-black text-cyan-400">
                              {Math.round(pop)}%
                            </span>
                          )}
                          <span className="text-2xl leading-none drop-shadow-md">{Icon}</span>
                        </div>
                        <div className="flex items-center justify-center">
                          <span className="text-xs font-bold text-white">{formatTempC(row.temp)}°</span>
                        </div>
                        <div className="flex flex-col items-center justify-center gap-0.5 text-[9px] font-semibold leading-tight text-slate-200">
                          <div className="flex items-center gap-[6px]">
                            <Wind className="h-3 w-3 shrink-0 text-cyan-300/90" aria-hidden />
                            <span>{windSpeedKmh(row.windSpeed)} km/h</span>
                          </div>
                          <div className="flex items-center gap-[6px]">
                            <WindCompass direction={row.windDir} size={18} />
                            <span className="text-[8px] font-bold text-slate-400">{windDirLabel(row.windDir)}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-center justify-center gap-0.5 text-[9px] font-semibold text-slate-200">
                          <div className="flex items-center gap-[6px]">
                            <Sun className="h-3 w-3 shrink-0 text-amber-200/90" aria-hidden />
                            <span>
                              UV{' '}
                              {row.uvIndex != null && Number.isFinite(row.uvIndex)
                                ? row.uvIndex.toFixed(1)
                                : '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] font-bold text-slate-400">{timeStr}</span>

                      <div className="my-2 flex h-10 flex-col items-center justify-center">
                        {showPop && (
                          <span className="mb-0.5 text-[9px] font-black text-cyan-400">
                            {Math.round(pop)}%
                          </span>
                        )}
                        <span className="text-2xl drop-shadow-md">{Icon}</span>
                      </div>

                      <span className="text-xs font-bold text-white">{formatTempC(row.temp)}°</span>
                    </>
                  )}
                </div>

                {showSunsetAfter && (
                  <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-1">
                    <div className="h-12 w-px bg-amber-400/50" />
                    <span className="origin-center rotate-90 whitespace-nowrap text-[8px] font-bold text-amber-400">
                      🌇
                    </span>
                    <div className="h-4 w-px bg-amber-400/30" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
      </HourlyScrollStrip>

      <div className="mb-5 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
  );
}

/** All hourly steps for one calendar day (Asia/Bangkok), for daily-card expanders */
export function HourlyStripForCalendarDay({
  rows,
  dateKey,
}: {
  rows: SamuiWeatherForecastRow[];
  dateKey: string;
}) {
  const dayRows = rows.filter((row) => {
    const d = new Date(row.time);
    if (Number.isNaN(d.getTime())) return false;
    const ds = d.toLocaleDateString('en-US', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return ds === dateKey;
  });

  if (dayRows.length === 0) {
    return (
      <p className="py-2 text-center text-[11px] text-slate-500">No hourly data for this day.</p>
    );
  }

  return (
    <HourlyScrollStrip scrollKey={dayRows.length} dense>
      {dayRows.map((row, i) => {
        const d = new Date(row.time);
        const timeStr = d.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Bangkok',
        });

        const pop = rainChancePercentForRow(row);
        const showPop = pop >= 10;

        const sun = getSunInfo(d);
        const isDay = sun.isDay;

        let Icon = isDay ? '☀️' : '🌙';
        if (row.precipRate > 0.5) Icon = '🌧️';
        else if (row.precipRate > 0.1) Icon = '🌦️';
        else if (row.cloudCover > 60) Icon = '☁️';
        else if (row.cloudCover > 20) Icon = isDay ? '⛅' : '☁️';

        return (
          <div
            key={`${row.time}-${i}`}
            className="flex min-w-[56px] shrink-0 snap-center flex-col items-center justify-between rounded-full px-2.5 py-2.5"
          >
            <span className="text-[10px] font-bold text-slate-400">{timeStr}</span>
            <div className="my-1.5 flex h-10 flex-col items-center justify-center">
              {showPop && (
                <span className="mb-0.5 text-[9px] font-black text-cyan-400">
                  {Math.round(pop)}%
                </span>
              )}
              <span className="text-xl drop-shadow-md">{Icon}</span>
            </div>
            <span className="text-xs font-bold text-white">{formatTempC(row.temp)}°</span>
          </div>
        );
      })}
    </HourlyScrollStrip>
  );
}
