'use client';

import React, { useRef, useState } from 'react';
import type { SamuiWeatherForecastRow } from '../lib/spire';
import { getSunInfo } from '../lib/sun';
import { HourlyStripForCalendarDay } from './HourlyForecast';

interface DailyForecastProps {
  rows: SamuiWeatherForecastRow[];
  onDayClick?: (spireIndex: number) => void;
}

interface DailyData {
  dateStr: string;
  dayName: string;
  minTemp: number;
  maxTemp: number;
  maxPop: number;
  maxPrecipRate: number;
  maxWindGust: number;
  avgCloudCover: number;
  hoursCount: number;
  noonIndex: number;
}

export default function DailyForecast({ rows, onDayClick }: DailyForecastProps) {
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);
  const [showExtendedDays, setShowExtendedDays] = useState(false);
  const extendedRef = useRef<HTMLDivElement>(null);

  const dailyMap = new Map<string, DailyData>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const d = new Date(row.time);
    if (Number.isNaN(d.getTime())) continue;

    const dateStr = d.toLocaleDateString('en-US', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const dayName = d.toLocaleDateString('en-US', {
      timeZone: 'Asia/Bangkok',
      weekday: 'short',
    });

    const hourStr = d.toLocaleTimeString('en-US', { hour: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });
    const hour = parseInt(hourStr, 10);

    let pop = row.pop;
    if (!pop && row.precipRate > 0) {
      pop = Math.min(100, Math.round(row.precipRate * 20) + 20);
    }

    if (!dailyMap.has(dateStr)) {
      dailyMap.set(dateStr, {
        dateStr,
        dayName,
        minTemp: row.temp,
        maxTemp: row.temp,
        maxPop: pop,
        maxPrecipRate: row.precipRate,
        maxWindGust: row.windGust,
        avgCloudCover: row.cloudCover,
        hoursCount: 1,
        noonIndex: i,
      });
    } else {
      const data = dailyMap.get(dateStr)!;
      data.minTemp = Math.min(data.minTemp, row.temp);
      data.maxTemp = Math.max(data.maxTemp, row.temp);
      data.maxPop = Math.max(data.maxPop, pop);
      data.maxPrecipRate = Math.max(data.maxPrecipRate, row.precipRate);
      data.maxWindGust = Math.max(data.maxWindGust, row.windGust);
      data.avgCloudCover += row.cloudCover;
      data.hoursCount += 1;
      if (Math.abs(hour - 12) < 2) data.noonIndex = i;
    }
  }

  const dailyArray = Array.from(dailyMap.values());
  const next3 = dailyArray.slice(0, 3);
  const extended = dailyArray.slice(3, 15);

  if (dailyArray.length === 0) return null;

  const getIcon = (day: DailyData, forceMoon = false) => {
    const avgCloud = day.avgCloudCover / day.hoursCount;
    let Icon = forceMoon ? '🌙' : '☀️';
    if (day.maxPrecipRate > 1.5) Icon = '🌧️';
    else if (day.maxPrecipRate > 0.1) Icon = '🌦️';
    else if (avgCloud > 60) Icon = '☁️';
    else if (avgCloud > 20) Icon = forceMoon ? '☁️' : '⛅';
    return Icon;
  };

  const currentSun = getSunInfo();
  const isNightCurrently = !currentSun.isDay;

  const handleDayTap = (day: DailyData) => {
    onDayClick?.(day.noonIndex);
    setExpandedDayKey((prev) => (prev === day.dateStr ? null : day.dateStr));
  };

  const expandedDay =
    expandedDayKey != null ? dailyArray.find((d) => d.dateStr === expandedDayKey) : null;

  const expandedLabel = expandedDay
    ? (() => {
        const i = dailyArray.findIndex((d) => d.dateStr === expandedDay.dateStr);
        const isToday = i === 0;
        const isTomorrow = i === 1;
        const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : expandedDay.dayName;
        return `${label} · ${expandedDay.dateStr}`;
      })()
    : '';

  return (
    <div className="flex flex-col gap-3">
      <p className="pl-1 text-[9px] font-black uppercase tracking-widest text-cyan-400">
        Next 3 days · tap for hourly
      </p>

      <div className="flex items-stretch gap-2 sm:gap-3">
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-2 sm:gap-3">
          {next3.map((day, index) => {
            const isToday = index === 0;
            const isTomorrow = index === 1;
            const displayDay = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : day.dayName;
            const useMoon = isToday && isNightCurrently;
            const Icon = getIcon(day, useMoon);
            const shortDate = (() => {
              const parts = day.dateStr.split('/');
              return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : day.dateStr;
            })();
            const isOpen = expandedDayKey === day.dateStr;

            return (
              <button
                key={day.dateStr}
                type="button"
                onClick={() => handleDayTap(day)}
                className={[
                  'flex flex-col items-center justify-between rounded-3xl border bg-slate-900/80 p-3 shadow-2xl backdrop-blur-xl transition-all sm:p-4',
                  isOpen ? 'border-cyan-500/50 ring-1 ring-cyan-500/20' : 'border-white/10 hover:border-cyan-500/30 hover:bg-slate-800/80',
                ].join(' ')}
              >
                <span
                  className={`text-xs font-medium capitalize ${isToday ? 'font-bold text-white' : 'text-slate-300'}`}
                >
                  {displayDay}
                </span>
                <span className="mb-1 text-[9px] text-slate-500 sm:mb-2">{shortDate}</span>

                <div className="relative mb-1 flex h-10 w-10 items-center justify-center text-3xl drop-shadow-md sm:h-12 sm:w-12 sm:text-4xl">
                  {Icon}
                  {day.maxPop >= 10 && (
                    <span className="absolute -bottom-2 text-[9px] font-black text-cyan-400">
                      {Math.round(day.maxPop)}%
                    </span>
                  )}
                </div>

                <div className="mt-1 flex w-full items-center justify-between px-0.5 text-sm font-mono sm:mt-2">
                  <span className="font-bold text-white">{Math.round(day.maxTemp)}°</span>
                  <span className="text-slate-400">{Math.round(day.minTemp)}°</span>
                </div>

                <div className="mt-1 flex items-center gap-1 text-[9px] text-slate-400">
                  💨 {Math.round(day.maxWindGust)} kts
                </div>
              </button>
            );
          })}
        </div>

        {extended.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowExtendedDays(true);
              window.setTimeout(() => {
                extendedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }, 50);
            }}
            className="flex w-11 shrink-0 flex-col items-center justify-center gap-1 rounded-3xl border border-dashed border-cyan-500/35 bg-slate-900/60 px-1 text-cyan-300/90 shadow-xl backdrop-blur-md transition hover:border-cyan-400/50 hover:bg-slate-800/80"
            aria-label="Show days 4 through 15"
            title="More forecast — up to 15 days"
          >
            <span className="text-lg font-black leading-none">→</span>
            <span className="text-[7px] font-black uppercase leading-tight tracking-tighter text-slate-500">
              4–15
            </span>
          </button>
        )}
      </div>

      {expandedDayKey && expandedDay && (
        <div className="rounded-2xl border border-cyan-500/25 bg-slate-950/70 px-3 py-3 backdrop-blur-xl">
          <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-cyan-400">
            Hourly · {expandedLabel}
          </p>
          <HourlyStripForCalendarDay rows={rows} dateKey={expandedDayKey} />
        </div>
      )}

      {extended.length > 0 && showExtendedDays && (
        <div
          id="extended-daily-forecast"
          ref={extendedRef}
          className="rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-3 backdrop-blur-xl"
        >
          <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">
            Days 4–15 · tap to jump timeline · tap again for hourly
          </p>
          <div className="flex w-full snap-x snap-mandatory gap-2 overflow-x-auto pb-1 pt-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {extended.map((day) => {
              const precipH = Math.min(20, Math.max(2, day.maxPrecipRate * 3));
              const Icon = getIcon(day);
              const isOpen = expandedDayKey === day.dateStr;
              return (
                <button
                  key={day.dateStr}
                  type="button"
                  onClick={() => handleDayTap(day)}
                  className={[
                    'flex shrink-0 snap-center flex-col items-center gap-0.5 rounded-xl px-2.5 py-2 transition',
                    isOpen ? 'bg-cyan-500/15 ring-1 ring-cyan-500/30' : 'hover:bg-white/5',
                  ].join(' ')}
                  title={`${day.dayName} ${day.dateStr}`}
                >
                  <span className="text-[9px] font-bold capitalize text-slate-400">{day.dayName}</span>
                  <span className="text-base">{Icon}</span>
                  <div className="flex h-5 w-full flex-col items-center justify-end">
                    <div
                      className="w-1.5 rounded-full bg-cyan-500/60"
                      style={{ height: `${precipH}px` }}
                    />
                  </div>
                  <span className="text-[8px] font-mono text-slate-400">{Math.round(day.maxTemp)}°</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
