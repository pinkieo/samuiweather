'use client';

import React from 'react';
import type { SamuiWeatherForecastRow } from '../lib/spire';
import { getSunInfo } from '../lib/sun';

interface HourlyForecastProps {
  rows: SamuiWeatherForecastRow[];
}

export default function HourlyForecast({ rows }: HourlyForecastProps) {
  const next12 = rows.slice(0, 12);

  // Find which index the sunset falls between
  const sunInfo = getSunInfo();
  const sunsetMs = sunInfo.sunset.getTime();
  const sunsetInsertAfter = next12.findIndex((row, i) => {
    const curr = new Date(row.time).getTime();
    const next = next12[i + 1] ? new Date(next12[i + 1].time).getTime() : Infinity;
    return curr <= sunsetMs && sunsetMs < next;
  });

  return (
    <div className="w-full">
      <div className="flex w-full snap-x snap-mandatory gap-2 overflow-x-auto pb-4 pt-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {next12.map((row, i) => {
          const d = new Date(row.time);
          const isNow = i === 0;
          const timeStr = isNow
            ? 'NOW'
            : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });

          const temp = Math.round(row.temp);

          let pop = row.pop;
          if (!pop && row.precipRate > 0) {
            pop = Math.min(100, Math.round(row.precipRate * 20) + 20);
          }
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
            <React.Fragment key={row.time}>
              <div
                className={`flex shrink-0 snap-center flex-col items-center justify-between rounded-full px-3 py-3 min-w-[60px] ${
                  isNow ? 'bg-white/10 ring-1 ring-white/20' : ''
                }`}
              >
                <span className={`text-[10px] font-bold ${isNow ? 'text-white' : 'text-slate-400'}`}>
                  {timeStr}
                </span>

                <div className="my-2 flex h-10 flex-col items-center justify-center">
                  {showPop && (
                    <span className="mb-0.5 text-[9px] font-black text-cyan-400">
                      {Math.round(pop)}%
                    </span>
                  )}
                  <span className="text-2xl drop-shadow-md">{Icon}</span>
                </div>

                <span className="text-xs font-bold text-white">{temp}°</span>
              </div>

              {/* Sunset divider */}
              {showSunsetAfter && (
                <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-1">
                  <div className="h-12 w-px bg-amber-400/50" />
                  <span className="text-[8px] font-bold text-amber-400 rotate-90 origin-center whitespace-nowrap">🌇</span>
                  <div className="h-4 w-px bg-amber-400/30" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

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
    <div className="flex w-full snap-x snap-mandatory gap-2 overflow-x-auto pb-1 pt-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {dayRows.map((row, i) => {
        const d = new Date(row.time);
        const timeStr = d.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Bangkok',
        });

        const temp = Math.round(row.temp);
        let pop = row.pop;
        if (!pop && row.precipRate > 0) {
          pop = Math.min(100, Math.round(row.precipRate * 20) + 20);
        }
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
            <span className="text-xs font-bold text-white">{temp}°</span>
          </div>
        );
      })}
    </div>
  );
}
