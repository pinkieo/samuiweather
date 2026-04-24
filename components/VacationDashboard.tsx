'use client';

import { Sun } from 'lucide-react';
import { formatTempC, formatWindMs, SAMUI_CENTER, type SamuiWeatherForecastRow } from '../lib/spire';
import type { TideTrend } from '../lib/tides';
import { getBeachAdvise, beachAdviseLabels, explainTideHeightMsl } from '../lib/tides';
import { getWindInfo, getBeachGuideSentence } from '../lib/vacation';
import { getSunInfoAt } from '../lib/sun';
import {
  effectiveCloudCoverDisplay,
  type MetarDominantCover,
} from '../lib/sky-display';
import type { SammiDailyForecastViewRow } from '../lib/sammi-views';
import {
  beachScoreVerdictClasses,
  calculateBeachSunScore,
} from '../lib/beachSunScore';
import HourlyForecast from './HourlyForecast';
import DailyForecast from './DailyForecast';

const TZ_ICT = 'Asia/Bangkok';

function bangkokDateKey(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      timeZone: TZ_ICT,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '';
  }
}

/** Uur 0–23 in ICT voor dit forecast-moment (strand-venster / avond). */
function bangkokHourFromIso(iso: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 12;
  const hourStr = d.toLocaleTimeString('en-US', {
    timeZone: TZ_ICT,
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  return parseInt(hourStr, 10) || 0;
}

function bangkokTimeShort(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: TZ_ICT,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

/** "Today" / "Tomorrow" / korte datum — zodat helder is welk moment het oordeel beschrijft. */
function forecastDayContextLabel(iso: string): string {
  const rowKey = bangkokDateKey(iso);
  const todayKey = new Date().toLocaleDateString('en-US', {
    timeZone: TZ_ICT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  if (rowKey === todayKey) return 'Today';
  const tmr = new Date();
  tmr.setDate(tmr.getDate() + 1);
  const tomorrowKey = tmr.toLocaleDateString('en-US', {
    timeZone: TZ_ICT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  if (rowKey === tomorrowKey) return 'Tomorrow';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      timeZone: TZ_ICT,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Forecast';
  }
}

export type VacationDashboardProps = {
  rows: SamuiWeatherForecastRow[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  tideTrend: TideTrend;
  tideHeightM: number | null;
  /** Sunrise/sunset for verdict (defaults to Koh Samui). */
  sunLatitude?: number;
  sunLongitude?: number;
  /**
   * Latest-scan RainViewer echo at the property pin while Spire + Meteoblue “now” still look dry —
   * verdict + snapshot treat radar as leading for active convection.
   */
  radarLeadsOverDryModels?: boolean;
  /** VTSM / VTSG dominant layer — softens model cloud % when METAR is clear/few. */
  metarSkyCover?: MetarDominantCover;
  /** Key = Bangkok calendar `YYYY-MM-DD` (from `sammi_daily_forecast.forecast_date`). */
  sammiDailyByIsoDay?: Record<string, SammiDailyForecastViewRow> | null;
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

/** Deterministische keuze: zelfde uur → zelfde zin, verschillende uren → mix. */
function pickVariant(seed: string, variants: readonly string[]): string {
  if (variants.length === 0) return '';
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return variants[Math.abs(h) % variants.length] ?? variants[0]!;
}

/**
 * ~20+ unieke avond-/nachtaanbevelingen, verdeeld over weertype en tijdvak.
 * (Zware bui / storm zit in eerdere takken boven deze functie.)
 */
function buildEveningNightSub(
  row: SamuiWeatherForecastRow,
  slot: string,
  opts: { lateEvening: boolean; bkHour: number },
): string {
  const base = `${slot} · ${formatTempC(row.temp)}°C · ${formatWindMs(row.windSpeed)} m/s`;
  const pr = row.precipRate;
  const breezy = row.windSpeed > 6;
  const seed = row.time;

  const wetHeavy: readonly string[] = [
    'Wet — take a solid umbrella; dinner indoors or under a permanent roof is the comfortable choice.',
    'Rain-heavy air — skip open sand; book a table inside or a covered deck so clothes stay dry.',
    'Splashy conditions — umbrella from door to door; street-side kitchens often pack tighter when it pours.',
    'Soaked paths likely — prioritise indoor dining; if you walk, stick to lit roads and skip remote beaches.',
    'Downpour vibe in the data — treat it as a cosy-night meal inside, or dry verandas only.',
  ];

  const wetMid: readonly string[] = [
    'Showers likely — keep an umbrella visible; indoor dining or a dry terrace beats guessing the gaps between drops.',
    'Unsteady drizzle risk — pack a brolly; restaurants with inside seating or wind-proof awnings are safest.',
    'On-and-off rain — split the plan: short outside drink if cover is good, otherwise move the meal indoors.',
    'Unsettled — umbrella + sandals; avoid long walks on wet sand and favour places with a roof line.',
    'Moist evening — choose menus you can enjoy under cover; street food under canvas can still work.',
  ];

  const wetLight: readonly string[] = [
    'Possible drizzle — a compact umbrella is enough; undercover seating keeps dinner relaxed.',
    'Light spray possible — light jacket or umbrella; al-fresco is fine if tables sit under sails or trees.',
    'Spits of rain — not a washout; pick venues with a Plan B table inside.',
    'A little damp in the forecast — dry terraces first, then pivot indoors if clouds thicken.',
    'Trickle-risk only — casual beachwalk OK if you hug the dry line under palms; eat under cover to play safe.',
  ];

  const windyLate: readonly string[] = [
    'Breezy night — short stroll on firm, lit sand; for dinner outside, tuck into the leeward side of the building.',
    'Lively air after sunset — beach walk: keep it brief; dining: sheltered corners or glass-front rooms.',
    'Wind in the trees — romantic on a terrace behind a windbreak; skip exposed pier tables.',
    'Gusty but dry — kite feel in the hair; choose seats with a back wall if you eat outdoors.',
    'Onshore breeze — foam sounds louder; walk where the slope is gentle and lights mark the exit.',
  ];

  const windyNight: readonly string[] = [
    'Windy after dark — shorten coast walks; indoor tables beat chasing napkins on the deck.',
    'Blowy night — ears get cool fast; scarf or light layer for outside queues at popular spots.',
    'Choppy vibe inland too — sheltered patios or booths indoors for a calm conversation.',
    'Air on the move — check that beach paths are lit; dine where staff can seat you out of the draught.',
    'Fresh trades — great for sleep later; for now, favour restaurants with a solid windward wall.',
  ];

  const calmLate: readonly string[] = [
    'Soft evening — ideal for a slow beach walk; many kitchens serve on the sand until late.',
    'Glassy twilight — tide sounds carry; outdoor tables shine when the sky clears.',
    'Easy mood — stroll first, then pick a lit strip for drinks or seafood facing the sea.',
    'Calm air — barefoot OK on packed sand; book outside if you like people-watching.',
    'Gentle night drop — warm enough often for sleeves only; ask for terrace if insects are low.',
    'Quiet swell — romantic lane walks; rooftop or garden seating can beat the crowded front row.',
    'Peaceful — night swim only where flags say OK and lights exist; otherwise paddle ankle-deep.',
    'Mellow ICT hour — sunset colours fade; string-lights terraces come into their own.',
  ];

  const preDawn: readonly string[] = [
    'Small hours — almost nobody on the strand; stick to hotel ground or lit paths you know.',
    'Before dawn — cool air; wrap lightly; cafés rarely open yet except hotels and petrol-station coffee.',
    'Early-dark body-clock — if you wander, tell someone; tides can surprise on black-sand bays.',
    'Pre-breakfast window — street kitchens wake around six; until then, room service or mini-bar.',
    'Still night on the clock — stars if sky is clear; avoid swimming without daylight lifeguard logic.',
  ];

  const calmNight: readonly string[] = [
    'Night on the coast — easy shoreline walk where you feel secure; mix of indoor and al-fresco dining.',
    'After dinner hours — low music strips, ice-cream kiosks, sometimes fire shows; keep valuables minimal.',
    'Late ICT slot — cooler sand underfoot; long-sleeve helps on a scooter ride home.',
    'Dark-blue hour — phone torch for potholes; beach bars may still pulse on weekends.',
    'Calm night data — mosquitos near mangroves; citronella or indoor backup if you attract bites.',
    'Restful — listen to waves from a balcony table; many hotels do room-tier service late.',
    'Low hum of crickets — romantic if dry; if humid, AC dining rooms win.',
    'Safe-traffic first — shared Grab back to the villa beats dark unlit shortcuts.',
  ];

  let suffix: string;

  if (pr > 0.25) {
    suffix = pickVariant(`${seed}-wh`, wetHeavy);
  } else if (pr > 0.1) {
    suffix = pickVariant(`${seed}-wm`, wetMid);
  } else if (pr > 0.03) {
    suffix = pickVariant(`${seed}-wl`, wetLight);
  } else if (breezy && opts.lateEvening) {
    suffix = pickVariant(`${seed}-wl-bz`, windyLate);
  } else if (breezy) {
    suffix = pickVariant(`${seed}-wn-bz`, windyNight);
  } else if (opts.lateEvening) {
    suffix = pickVariant(`${seed}-cl`, calmLate);
  } else if (opts.bkHour < 5) {
    suffix = pickVariant(`${seed}-pd`, preDawn);
  } else {
    suffix = pickVariant(`${seed}-cn`, calmNight);
  }

  return `${base}. ${suffix}`;
}

/**
 * Beach Sun Score v2 + safety overrides. Radar / tropical storm / wind still win over pure score.
 */
function getVerdict(
  row: SamuiWeatherForecastRow,
  sunInfo: ReturnType<typeof getSunInfoAt>,
  bkHour: number,
  opts?: { radarLeadsOverDryModels?: boolean },
): Verdict {
  const slot = `${forecastDayContextLabel(row.time)} · ${bangkokTimeShort(row.time)} ICT`;
  const beach = calculateBeachSunScore(row);
  const fromScore = (): Verdict => {
    const c = beachScoreVerdictClasses[beach.color];
    return {
      label: beach.label,
      sub: `${forecastDayContextLabel(row.time)} · ${bangkokTimeShort(row.time)} ICT · Score ${beach.score}/100`,
      bg: c.bg,
      border: c.border,
      text: c.text,
      dot: c.dot,
    };
  };

  if (row.precipRate > 2) {
    return {
      label: '⛈️ Tropical Storm Expected',
      sub: `${slot} · ${row.precipRate.toFixed(1)} mm/h · Stay indoors or seek shelter`,
      bg: 'bg-rose-950/60', border: 'border-rose-500/40', text: 'text-rose-200', dot: 'bg-rose-400',
    };
  }

  if (opts?.radarLeadsOverDryModels && row.precipRate < 0.2) {
    return {
      label: '📡 Radar-led · rain at your pin',
      sub: `${slot} · Spire and Meteoblue can stay dry while real showers move through — trust the live radar echo for what is overhead now.`,
      bg: 'bg-sky-950/60',
      border: 'border-sky-400/45',
      text: 'text-sky-100',
      dot: 'bg-sky-400',
    };
  }

  if (row.windSpeed > 9.3) {
    return {
      label: '💨 Wind Advisory · Choppy Seas',
      sub: `${slot} · ${formatWindMs(row.windSpeed)} m/s wind · Beach Sun Score ${beach.score}/100 — consider sheltered beaches`,
      bg: 'bg-amber-950/60', border: 'border-amber-500/30', text: 'text-amber-200', dot: 'bg-amber-400',
    };
  }

  if (!sunInfo.isDay || bkHour >= 19 || bkHour < 5) {
    const lateEvening = bkHour >= 19 && bkHour < 22;
    const v = fromScore();
    return {
      label: lateEvening ? '🌅 Evening · coast quiet' : '🌙 Night · coastal conditions',
      sub: `${buildEveningNightSub(row, slot, { lateEvening, bkHour })} · Beach Sun Score ${beach.score}/100`,
      bg: v.bg,
      border: v.border,
      text: v.text,
      dot: v.dot,
    };
  }

  /** Ochtend (na zonsopgang, vóór 08:00 ICT): zelfde ladder als overdag — gebruikers checken bij opstaan. */
  if ((row.uvIndex != null && row.uvIndex > 10) || row.temp > 34) {
    const v = fromScore();
    return {
      label: '☀️ Extreme Heat · Seek Shade',
      sub: `${slot} · ${formatTempC(row.temp)}°C · UV ${row.uvIndex?.toFixed(0) ?? '—'} · Score ${beach.score}/100 · Apply SPF 50+ every 2 hours`,
      bg: v.bg,
      border: v.border,
      text: v.text,
      dot: v.dot,
    };
  }
  if (row.uvIndex != null && row.uvIndex > 7) {
    const v = fromScore();
    return {
      label: '🏖️ Great Beach Day · High UV',
      sub: `${slot} · ${formatTempC(row.temp)}°C · UV ${row.uvIndex.toFixed(0)} · Score ${beach.score}/100 · Apply SPF 50+ sunscreen`,
      bg: v.bg,
      border: v.border,
      text: v.text,
      dot: v.dot,
    };
  }

  return fromScore();
}

/** ICT uren 11–15: waar UV/temp het ergst is — ochtend kan “perfect” zijn terwijl ~13:00 brandt. */
const PEAK_SOLAR_ICT_START = 11;
const PEAK_SOLAR_ICT_END = 15;

function findPeakSolarStressHour(
  rows: SamuiWeatherForecastRow[],
  dayKey: string,
): { hour: number; uv: number | null; temp: number } | null {
  let best: { hour: number; uv: number | null; temp: number } | null = null;
  for (const r of rows) {
    if (bangkokDateKey(r.time) !== dayKey) continue;
    const h = bangkokHourFromIso(r.time);
    if (h < PEAK_SOLAR_ICT_START || h > PEAK_SOLAR_ICT_END) continue;
    const uv = r.uvIndex;
    if (!best) {
      best = { hour: h, uv: uv ?? null, temp: r.temp };
      continue;
    }
    const bu = best.uv ?? -1;
    const ru = uv ?? -1;
    if (ru > bu) best = { hour: h, uv: uv ?? null, temp: r.temp };
    else if (ru === bu && r.temp > best.temp) {
      best = { hour: h, uv: uv ?? null, temp: r.temp };
    }
  }
  return best;
}

function peakStressIsBrutal(peak: { uv: number | null; temp: number }): boolean {
  return (peak.uv != null && peak.uv >= 8) || peak.temp >= 33;
}

/**
 * Voegt waarschuwing toe als dit uur nog relaxed oogt maar rond het middaguur UV/hitte pieken.
 */
function augmentVerdictWithSolarPeakHint(
  verdict: Verdict,
  row: SamuiWeatherForecastRow,
  rows: SamuiWeatherForecastRow[],
): Verdict {
  const labelsNeedHint =
    verdict.label.includes('Perfect Beach Day') ||
    verdict.label.includes('Great Beach Day · High UV') ||
    verdict.label.includes('Good Beach Day');
  if (!labelsNeedHint || rows.length < 2) return verdict;

  const hSel = bangkokHourFromIso(row.time);
  if (
    hSel >= PEAK_SOLAR_ICT_START &&
    hSel <= PEAK_SOLAR_ICT_END &&
    row.uvIndex != null &&
    row.uvIndex >= 8
  ) {
    return verdict;
  }

  const dayKey = bangkokDateKey(row.time);
  const peak = findPeakSolarStressHour(rows, dayKey);
  if (!peak || !peakStressIsBrutal(peak)) return verdict;

  const peakTime = `${String(peak.hour).padStart(2, '0')}:00`;
  const parts: string[] = [];
  if (peak.uv != null && peak.uv >= 8) parts.push(`UV ~${Math.round(peak.uv)}`);
  if (peak.temp >= 33) parts.push(`${formatTempC(peak.temp)}°C`);
  const stats = parts.length ? ` (${parts.join(' · ')})` : '';

  const extra = ` · Peak sun/heat stress today is expected ~${peakTime} ICT${stats} — plan shade or short sessions then (hat, SPF 50+).`;
  return { ...verdict, sub: verdict.sub + extra };
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
  radarLeadsOverDryModels = false,
  metarSkyCover = null,
  sammiDailyByIsoDay = null,
}: VacationDashboardProps) {
  const row = rows[selectedIndex] ?? rows[0];
  if (!row) return null;

  const bkHour = bangkokHourFromIso(row.time);
  const sunInfo = getSunInfoAt(sunLatitude, sunLongitude, new Date(row.time));
  const beachSun = calculateBeachSunScore(row);
  const verdict = augmentVerdictWithSolarPeakHint(
    getVerdict(row, sunInfo, bkHour, { radarLeadsOverDryModels }),
    row,
    rows,
  );

  // Weather Now
  const isDry = row.precipRate < 0.05;
  const weatherText = radarLeadsOverDryModels
    ? 'Radar echo overhead · hourly strip still looks dry — take cover if you see it pouring'
    : isDry
      ? 'Clear · No heavy rain in the hourly numbers'
      : 'Rain Expected · Bring Umbrella';

  // Beach Guide
  const { dir, sheltered } = getWindInfo(row.windDir);
  const windSpeed = formatWindMs(row.windSpeed);
  const beachStatus = getBeachAdvise(tideTrend, tideHeightM);
  const tideShort =
    tideHeightM != null && !Number.isNaN(tideHeightM)
      ? explainTideHeightMsl(tideHeightM)
      : '';
  const beachStr = beachStatus === 'neutral' ? 'Normal' : beachAdviseLabels[beachStatus].title;

  const bgClass = sunInfo.isDay ? 'bg-slate-900' : 'bg-slate-950';

  const rowTimeMs = new Date(row.time).getTime();
  const msToSunset = sunInfo.sunset.getTime() - rowTimeMs;
  const isGoldenHour = sunInfo.isDay && msToSunset > 0 && msToSunset <= 45 * 60000;
  const goldenHourStr = sunInfo.goldenHour.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
  });

  const windCondition: 'rain' | 'choppy' | 'calm' =
    row.precipRate > 0.4 ? 'rain' : row.windSpeed > 7.7 ? 'choppy' : 'calm';

  const beachGuideSentence = getBeachGuideSentence(
    row.windDir,
    row.windSpeed,
    sunInfo.isDay,
    isGoldenHour,
    windCondition,
  );

  const cloudDisp = effectiveCloudCoverDisplay(
    row.cloudCover,
    row.uvIndex,
    metarSkyCover,
  );

  return (
    <div className="mb-4 flex flex-col gap-3">
      {/* ── 1. Today · hourly (first) ─────────────────────────────────── */}
      <div>
        <p className="mb-2 pl-1 text-[9px] font-black uppercase tracking-widest text-cyan-400">
          Today · hourly
        </p>
        <HourlyForecast rows={rows} selectedIndex={selectedIndex} onHourSelect={onSelectedIndexChange} />
      </div>

      {/* ── 2. Daily outlook (scrollable, up to 15 days when Spire returns 360h) ──────────────── */}
      <DailyForecast
        rows={rows}
        onDayClick={onSelectedIndexChange}
        sammiDailyByIsoDay={sammiDailyByIsoDay ?? undefined}
      />

      {/* ── 3. Beach Sun Score + Verdict Hero ─────────────────────────── */}
      <div className="flex flex-col items-center gap-3">
        <div
          role="img"
          aria-label={`Beach Sun Score ${beachSun.score} out of 100`}
          className={[
            'relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full',
            'border-4 border-white/10 bg-gradient-to-br from-amber-400/20 via-white/5 to-sky-500/20',
            'shadow-[0_0_40px_rgba(251,191,36,0.15)]',
          ].join(' ')}
        >
          <Sun
            className="absolute h-14 w-14 text-amber-300/50"
            strokeWidth={1.25}
            aria-hidden
          />
          <span className="relative z-[1] text-3xl font-black tabular-nums text-white">
            {beachSun.score}
          </span>
        </div>
        <p className="text-center text-[10px] font-bold uppercase tracking-widest text-white/45">
          Beach Sun Score
        </p>
      </div>

      <div className={`rounded-3xl border ${verdict.border} ${verdict.bg} px-5 py-4 shadow-2xl`}>
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${verdict.dot} shadow-[0_0_8px_currentColor]`} />
          <p className={`text-base font-extrabold leading-tight ${verdict.text}`}>{verdict.label}</p>
        </div>
        <p className="mt-1.5 text-[11px] font-medium text-white/60 pl-[22px]">{verdict.sub}</p>
        <p className="mt-2 text-[11px] leading-snug text-white/50 pl-[22px]">{beachSun.advice}</p>
      </div>

      {/* ── 4. Weather Now + Beach Guide ────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={`rounded-3xl border border-white/10 p-5 shadow-2xl transition-colors duration-1000 ${bgClass}`}>
          <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-cyan-400">Weather snapshot</p>
          <p className="mb-2 text-[10px] text-slate-500">
            {forecastDayContextLabel(row.time)} · {bangkokTimeShort(row.time)} ICT
          </p>
          <p className="text-sm font-bold leading-snug text-white">{weatherText}</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white">{formatTempC(row.temp)}°C</span>
            <span className="text-xs font-bold text-slate-400">{row.precipRate.toFixed(1)} mm/h</span>
          </div>
          <p className="mt-0.5 text-[11px] tracking-wider text-white/50">
            Feels like {formatTempC(row.feelsLike)}°C
          </p>
          <p className="mt-2 text-[10px] text-slate-400">
            💧 {row.humidity}% humidity · ☁️ {cloudDisp.pct.toFixed(0)}% cloud cover
            {cloudDisp.note}
          </p>
        </div>

        <div className={`rounded-3xl border border-white/10 p-5 shadow-2xl transition-colors duration-1000 ${bgClass}`}>
          <div className="mb-2 flex items-center gap-1.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-emerald-400">Beach Guide</p>
            {/* Wind direction arrow */}
            <svg className="h-3 w-3 fill-current text-emerald-400/60" viewBox="0 0 24 24"
              style={{ transform: `rotate(${row.windDir + 180}deg)` }}>
              <path d="M12 2L20 20L12 17L4 20L12 2Z" />
            </svg>
            <span className="text-[9px] font-mono text-slate-500">{windSpeed} m/s</span>
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
