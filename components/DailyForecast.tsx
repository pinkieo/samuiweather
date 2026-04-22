'use client';

import React, { useState } from 'react';
import { formatTempC, formatWindMs, type SamuiWeatherForecastRow } from '../lib/spire';
import { getSunInfo } from '../lib/sun';
import { HourlyScrollStrip, HourlyStripForCalendarDay } from './HourlyForecast';

/** Cap daily strip at 15 calendar days (matches ~360h Spire target when available). */
const MAX_DAILY_OUTLOOK = 15;

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
  /** Strongest hourly sustained wind (m/s) — matches hourly strip / Sammi wording. */
  maxWindSpeed: number;
  maxWindGust: number;
  avgCloudCover: number;
  hoursCount: number;
  noonIndex: number;
}

export default function DailyForecast({ rows, onDayClick }: DailyForecastProps) {
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);

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
        maxWindSpeed: row.windSpeed,
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
      data.maxWindSpeed = Math.max(data.maxWindSpeed, row.windSpeed);
      data.maxWindGust = Math.max(data.maxWindGust, row.windGust);
      data.avgCloudCover += row.cloudCover;
      data.hoursCount += 1;
      if (Math.abs(hour - 12) < 2) data.noonIndex = i;
    }
  }

  const dailyArray = Array.from(dailyMap.values()).slice(0, MAX_DAILY_OUTLOOK);

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

  const dayCount = dailyArray.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 pl-1 pr-0.5">
        <p className="text-[9px] font-black uppercase tracking-widest text-cyan-400">
          Daily outlook · up to {MAX_DAILY_OUTLOOK} days · {dayCount} loaded · swipe · tap for hourly
        </p>
      </div>

      <HourlyScrollStrip scrollKey={dailyArray.length}>
        {dailyArray.map((day, index) => {
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
            const precipH = Math.min(18, Math.max(2, day.maxPrecipRate * 3));

            return (
              <button
                key={day.dateStr}
                type="button"
                onClick={() => handleDayTap(day)}
                className={[
                  'flex w-[5.25rem] shrink-0 snap-center flex-col items-center rounded-2xl border px-2 py-2.5 shadow-lg transition sm:w-[5.75rem] sm:px-2.5 sm:py-3',
                  isToday ? 'border-cyan-500/40 bg-slate-900' : 'border-white/10 bg-slate-900',
                  isOpen ? 'ring-1 ring-cyan-500/35' : 'hover:border-cyan-500/25 hover:bg-slate-800',
                ].join(' ')}
              >
                <span
                  className={`line-clamp-1 text-[10px] font-semibold capitalize leading-tight ${isToday ? 'text-white' : 'text-slate-300'}`}
                >
                  {displayDay}
                </span>
                <span className="mb-0.5 text-[8px] text-slate-500">{shortDate}</span>

                <div className="relative mb-0.5 flex h-9 w-9 items-center justify-center text-2xl sm:h-10 sm:w-10 sm:text-3xl">
                  {Icon}
                  {day.maxPop >= 10 && (
                    <span className="absolute -bottom-1 text-[8px] font-black text-cyan-400">
                      {Math.round(day.maxPop)}%
                    </span>
                  )}
                </div>

                <div className="flex h-4 w-full items-end justify-center">
                  <div
                    className="w-1 rounded-full bg-cyan-500/55"
                    style={{ height: `${precipH}px` }}
                    title="Precip intensity (proxy)"
                  />
                </div>

                <div className="mt-1 flex w-full items-center justify-between text-[10px] font-mono leading-none sm:text-[11px]">
                  <span className="font-bold text-white">{formatTempC(day.maxTemp)}°</span>
                  <span className="text-slate-400">{formatTempC(day.minTemp)}°</span>
                </div>

                <div
                  className="mt-0.5 line-clamp-2 text-[7px] text-slate-500 sm:text-[8px]"
                  title="Peak sustained wind that day (hourly Spire steps). Gust can be higher — see hourly tile for one hour."
                >
                  💨 {formatWindMs(day.maxWindSpeed)} m/s peak
                  {day.maxWindGust > day.maxWindSpeed + 0.05 ? (
                    <span className="block text-[6px] text-slate-600 sm:text-[7px]">
                      gust {formatWindMs(day.maxWindGust)} m/s
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
      </HourlyScrollStrip>

      {expandedDayKey && expandedDay && (
        <div className="rounded-2xl border border-cyan-500/25 bg-slate-950 px-3 py-3">
          <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-cyan-400">
            Hourly · {expandedLabel}
          </p>
          <HourlyStripForCalendarDay rows={rows} dateKey={expandedDayKey} />
        </div>
      )}
    </div>
  );
}
