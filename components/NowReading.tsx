'use client';

import { compass16FromDeg } from '../lib/shower-nowcast-schedule';
import { formatTempC, formatWindMs } from '../lib/spire';

export type NowStation = {
  fresh: boolean;
  /** Reading exists but is older than 20 minutes, or the station request failed. */
  late: boolean;
  tempC: number | null;
  rainRateMmh: number | null;
  windSpeedMs: number | null;
  windDirDeg: number | null;
};

type NowReadingProps = {
  station: NowStation | null;
  /** Current Spire hour, used only when the station reading is missing or late. */
  fallback: { tempC: number; windSpeedMs: number; windDirDeg: number } | null;
  /** Radar shows rain while the fresh station is dry. */
  radarWetWhileStationDry?: boolean;
};

function windPhrase(speed: number | null, dir: number | null): string {
  if (speed == null || !Number.isFinite(speed)) return '';
  const compass = dir != null && Number.isFinite(dir) ? `${compass16FromDeg(dir)} ` : '';
  return `${compass}${formatWindMs(speed)} m/s`;
}

export default function NowReading({
  station,
  fallback,
  radarWetWhileStationDry = false,
}: NowReadingProps) {
  const fresh = station?.fresh === true && station.tempC != null;
  const late = !fresh && station?.late === true;
  const temp = fresh ? station!.tempC : fallback?.tempC ?? null;
  const wind = fresh
    ? windPhrase(station!.windSpeedMs, station!.windDirDeg)
    : windPhrase(fallback?.windSpeedMs ?? null, fallback?.windDirDeg ?? null);
  const raining = fresh && (station!.rainRateMmh ?? 0) >= 0.05;

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-4">
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">Now</p>
      {fresh ? (
        <p className="mt-1 text-[15px] font-bold text-white">
          {formatTempC(temp)}°C
          {' · '}
          {raining ? `${station!.rainRateMmh!.toFixed(1)} mm/h` : 'not raining'}
          {wind ? ` · ${wind}` : ''}
        </p>
      ) : (
        <p className="mt-1 text-[15px] font-bold text-white">
          {late ? 'Station reading is late' : 'Current hour'}
          {temp != null ? ` · ${formatTempC(temp)}°C` : ''}
          {wind ? ` · ${wind}` : ''}
        </p>
      )}
      <p className="mt-1 text-[10px] text-slate-400">
        {fresh
          ? 'Garden station at Baan Ton Kluay.'
          : 'Temperature and wind are the current forecast hour. No rain percentage here.'}
      </p>
      {radarWetWhileStationDry && (
        <p className="mt-2 text-[11px] text-sky-200">Rain on the radar over the island.</p>
      )}
    </section>
  );
}
