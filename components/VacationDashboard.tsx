'use client';

import { formatTempC, formatWindKts, SAMUI_CENTER, type SamuiWeatherForecastRow } from '../lib/spire';
import type { TideTrend } from '../lib/tides';
import { getBeachAdvise, beachAdviseLabels, explainTideHeightMsl } from '../lib/tides';
import { getWindInfo, getBeachGuideSentence } from '../lib/vacation';
import { getSunInfoAt } from '../lib/sun';
import HourlyForecast from './HourlyForecast';
import DailyForecast from './DailyForecast';

export type VacationDashboardProps = {
  rows: SamuiWeatherForecastRow[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  tideTrend: TideTrend;
  tideHeightM: number | null;
  /** Sunrise/sunset for verdict (defaults to Koh Samui). */
  sunLatitude?: number;
  sunLongitude?: number;
};

// ─── Verdict logic ────────────────────────────────────────────────────────────

interface Verdict {
  label: string;
  sub: string;
  bg: string;
  border: string;
  text: string;
  dot: string;
}

function getVerdict(
  row: SamuiWeatherForecastRow,
  sunInfo: ReturnType<typeof getSunInfoAt>,
): Verdict {
  if (!sunInfo.isDay) {
    return {
      label: '🌙 Night Mode',
      sub: `Clear night · ${formatTempC(row.temp)}°C · Light breeze ${formatWindKts(row.windSpeed)} kts`,
      bg: 'bg-indigo-950/60', border: 'border-indigo-500/30', text: 'text-indigo-200', dot: 'bg-indigo-400',
    };
  }
  if (row.precipRate > 2) {
    return {
      label: '⛈️ Tropical Storm Expected',
      sub: `${row.precipRate.toFixed(1)} mm/h · Stay indoors or seek shelter`,
      bg: 'bg-rose-950/60', border: 'border-rose-500/40', text: 'text-rose-200', dot: 'bg-rose-400',
    };
  }
  if (row.precipRate > 0.4) {
    return {
      label: '🌧️ Rain Likely · Bring Umbrella',
      sub: `${row.precipRate.toFixed(1)} mm/h · ${formatTempC(row.temp)}°C · Brief showers expected`,
      bg: 'bg-blue-950/60', border: 'border-blue-500/30', text: 'text-blue-200', dot: 'bg-blue-400',
    };
  }
  if (row.windSpeed > 18) {
    return {
      label: '💨 Wind Advisory · Choppy Seas',
      sub: `${formatWindKts(row.windSpeed)} kts wind · Consider sheltered beaches`,
      bg: 'bg-amber-950/60', border: 'border-amber-500/30', text: 'text-amber-200', dot: 'bg-amber-400',
    };
  }
  if ((row.uvIndex != null && row.uvIndex > 10) || row.temp > 34) {
    return {
      label: '☀️ Extreme Heat · Seek Shade',
      sub: `${formatTempC(row.temp)}°C · UV ${row.uvIndex?.toFixed(0) ?? '—'} · Apply SPF 50+ every 2 hours`,
      bg: 'bg-orange-950/60', border: 'border-orange-500/30', text: 'text-orange-200', dot: 'bg-orange-400',
    };
  }
  if (row.uvIndex != null && row.uvIndex > 7) {
    return {
      label: '🏖️ Great Beach Day · High UV',
      sub: `${formatTempC(row.temp)}°C · UV ${row.uvIndex.toFixed(0)} · Apply SPF 50+ sunscreen`,
      bg: 'bg-yellow-950/60', border: 'border-yellow-500/30', text: 'text-yellow-200', dot: 'bg-yellow-400',
    };
  }
  return {
    label: '🏖️ Perfect Beach Day',
    sub: `${formatTempC(row.temp)}°C · ${formatWindKts(row.windSpeed)} kts · Ideal conditions`,
    bg: 'bg-emerald-950/60', border: 'border-emerald-500/30', text: 'text-emerald-200', dot: 'bg-emerald-400',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VacationDashboard({
  rows,
  selectedIndex,
  onSelectedIndexChange,
  tideTrend,
  tideHeightM,
  sunLatitude = SAMUI_CENTER.lat,
  sunLongitude = SAMUI_CENTER.lon,
}: VacationDashboardProps) {
  const row = rows[selectedIndex] ?? rows[0];
  if (!row) return null;

  const sunInfo = getSunInfoAt(sunLatitude, sunLongitude, new Date(row.time));
  const verdict = getVerdict(row, sunInfo);

  // Weather Now
  const isDry = row.precipRate === 0;
  const weatherText = isDry ? 'Clear · No Rain Expected' : 'Rain Expected · Bring Umbrella';

  // Beach Guide
  const { dir, sheltered } = getWindInfo(row.windDir);
  const windSpeed = formatWindKts(row.windSpeed);
  const beachStatus = getBeachAdvise(tideTrend, tideHeightM);
  const tideShort =
    tideHeightM != null && !Number.isNaN(tideHeightM)
      ? explainTideHeightMsl(tideHeightM)
      : '';
  const beachStr = beachStatus === 'neutral' ? 'Normal' : beachAdviseLabels[beachStatus].title;

  const bgClass = sunInfo.isDay ? 'bg-slate-900/80' : 'bg-slate-950/50';

  const now = new Date().getTime();
  const msToSunset = sunInfo.sunset.getTime() - now;
  const isGoldenHour = sunInfo.isDay && msToSunset > 0 && msToSunset <= 45 * 60000;
  const goldenHourStr = sunInfo.goldenHour.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  });

  const windCondition: 'rain' | 'choppy' | 'calm' =
    row.precipRate > 0.4 ? 'rain' : row.windSpeed > 15 ? 'choppy' : 'calm';

  const beachGuideSentence = getBeachGuideSentence(
    row.windDir,
    row.windSpeed,
    sunInfo.isDay,
    isGoldenHour,
    windCondition,
  );

  return (
    <div className="mb-4 flex flex-col gap-3">
      {/* ── 1. Today · hourly (first) ─────────────────────────────────── */}
      <div>
        <p className="mb-2 pl-1 text-[9px] font-black uppercase tracking-widest text-cyan-400">
          Today · hourly
        </p>
        <HourlyForecast rows={rows} />
      </div>

      {/* ── 2. Daily outlook (scrollable, up to 30 days) ──────────────── */}
      <DailyForecast rows={rows} onDayClick={onSelectedIndexChange} />

      {/* ── 3. Verdict Hero ─────────────────────────────────────────────── */}
      <div className={`rounded-3xl border ${verdict.border} ${verdict.bg} px-5 py-4 shadow-2xl backdrop-blur-xl`}>
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${verdict.dot} shadow-[0_0_8px_currentColor]`} />
          <p className={`text-base font-extrabold leading-tight ${verdict.text}`}>{verdict.label}</p>
        </div>
        <p className="mt-1.5 text-[11px] font-medium text-white/60 pl-[22px]">{verdict.sub}</p>
      </div>

      {/* ── 4. Weather Now + Beach Guide ────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={`rounded-3xl border border-white/10 p-5 shadow-2xl backdrop-blur-xl transition-colors duration-1000 ${bgClass}`}>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-cyan-400">Weather Now</p>
          <p className="text-sm font-bold leading-snug text-white">{weatherText}</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white">{formatTempC(row.temp)}°C</span>
            <span className="text-xs font-bold text-slate-400">{row.precipRate.toFixed(1)} mm/h</span>
          </div>
          <p className="mt-0.5 text-[11px] tracking-wider text-white/50">
            Feels like {formatTempC(row.feelsLike)}°C
          </p>
          <p className="mt-2 text-[10px] text-slate-400">
            💧 {row.humidity}% humidity · ☁️ {row.cloudCover.toFixed(0)}% cloud cover
          </p>
        </div>

        <div className={`rounded-3xl border border-white/10 p-5 shadow-2xl backdrop-blur-xl transition-colors duration-1000 ${bgClass}`}>
          <div className="mb-2 flex items-center gap-1.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400">Beach Guide</p>
            {/* Wind direction arrow */}
            <svg className="h-3 w-3 fill-current text-emerald-400/60" viewBox="0 0 24 24"
              style={{ transform: `rotate(${row.windDir + 180}deg)` }}>
              <path d="M12 2L20 20L12 17L4 20L12 2Z" />
            </svg>
            <span className="text-[9px] font-mono text-slate-500">{windSpeed} kts</span>
          </div>

          {/* Clean human-readable sentence */}
          <p className="text-sm font-semibold leading-snug text-white/90">
            {beachGuideSentence}
          </p>

          {/* Compact metadata row */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
            <span>🏖️ {beachStr}{tideShort && <span className="opacity-80"> · {tideShort}</span>}</span>
            <span>🏝️ {sheltered.beaches}</span>
          </div>

          {isGoldenHour && (
            <p className="mt-2 text-[10px] font-bold text-amber-400">
              ✨ Golden Hour now! Perfect time for {sheltered.beaches} photos.
            </p>
          )}
          {sunInfo.isDay && !isGoldenHour && (
            <p className="mt-2 text-[10px] text-slate-500">
              🌅 Golden Hour at {goldenHourStr}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
