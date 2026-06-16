'use client';

/**
 * Hybrid rain strip — two layouts:
 *
 * **Map (RainPlayer):** Live + last 3 clock hours = **4 segments** (−3h … now, Bangkok time).
 * Goal: see **where rain came from** using RainViewer scrub + pin snapshot. Wind from the
 * nearest Spire hour row is shown as context only (arrow under bar + chip; not “forecast strip” logic).
 *
 * **RainViewer data (read the whole chain):**
 * - Frame lists come from `https://api.rainviewer.com/public/weather-maps.json` via our
 *   `app/api/radar/frames` proxy (`RadarFramesProvider`).
 * - Typical **past** coverage is only on the order of **~2–3 hours** of real scans; there is **no
 *   long archive** in this app path.
 * - We do **not** persist radar tiles or full JSON — only **frame paths + Unix timestamps** in
 *   React state / refs for the current session.
 *
 * **Drawer:** Unchanged 18h hybrid outlook (radar + forecast blend, full chrome).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowUp } from 'lucide-react';
import { useRadarFeed } from './RadarFramesProvider';
import type { RadarFrame } from './RadarFramesProvider';
import type { SamuiWeatherForecastRow } from '@/lib/spire';
import { sampleRadarEchoNearPin } from '@/lib/rainviewer-tile-sample';
import {
  bangkokWindowHourStarts,
  buildHourlyRadarBuckets,
  hourBucketKeyBangkok,
  mergeRadarFrames,
  pickLatestFrameInHour,
  pickScrubFrameForHour,
  type HourBucketRadar,
} from '@/lib/radar-hourly-buckets';
import {
  buildHybridTimeline,
  findForecastRowNearHour,
  formatHourLabelBangkok,
  HYBRID_STRIP_FUTURE_COUNT,
  HYBRID_STRIP_PAST_COUNT,
  hybridBarStyle,
  pickHybridHeadline,
  type HybridLayer,
  type HybridRainLabel,
} from '@/lib/hybrid-rain-timeline';
import { rainChancePercentForRow } from '@/lib/sammi-views';
import { toSpireForecastFrame, type HybridRainBar } from '@/lib/hybrid-rain-data';
import { formatWindKmHFromRow } from '@/lib/hybrid-beach-wind';
import { stripBarIndexToClockOffset } from '@/lib/hybrid-strip-data-source';
import {
  getOverlayUrlForIndex,
  hybridStripAnchorHourStartUtc,
  resolveHourRadarFrame,
} from '@/lib/hybrid-strip-overlay-url';

/** Map strip: one bar per hour for T−3 … T0 (four bars). Drawer keeps default hybrid window. */
const MAP_STRIP_PAST_HOURS = 3;
const MAP_STRIP_FUTURE_HOURS = 0;

const YIELD_MS = 48;

function yieldToMap(): Promise<void> {
  return new Promise((r) => window.setTimeout(r, YIELD_MS));
}

function formatHourTooltip(utcSec: number): string {
  return new Date(utcSec * 1000).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function layerHintEn(layer: HybridLayer): string {
  if (layer === 'radar') return 'Mostly live radar at your pin (first ~3h).';
  if (layer === 'blend') return 'Mix: radar + forecast (about 3–6h ahead).';
  return 'Forecast-led further out (6–18h; rough timing).';
}

function formatHourClockBangkok(utcSec: number): string {
  return new Date(utcSec * 1000).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function mapBarTooltipLines(
  hourStartUtc: number,
  forecastRow: SamuiWeatherForecastRow | null,
): string {
  const clock = formatHourClockBangkok(hourStartUtc);
  const precip =
    forecastRow != null && Number.isFinite(forecastRow.precip)
      ? `${forecastRow.precip.toFixed(1)} mm`
      : '—';
  const wind =
    forecastRow != null &&
    Number.isFinite(forecastRow.windDir) &&
    Number.isFinite(forecastRow.windSpeed)
      ? formatWindKmHFromRow(forecastRow.windSpeed, forecastRow.windDir)
      : '—';
  return `${clock} ICT • ${precip} • Wind ${wind}`;
}

const RAIN_LABEL_COMPACT: Record<HybridRainLabel, string> = {
  Heavy: 'Heavy',
  Moderate: 'Moderate',
  Light: 'Light',
  Passing: 'Passing',
};

function layerRingClass(layer: HybridLayer): string {
  if (layer === 'radar') return 'ring-1 ring-cyan-500/30';
  if (layer === 'blend') return 'ring-1 ring-amber-400/25';
  return 'ring-1 ring-violet-400/25';
}

const PLAY_MS = 900;

export type HybridRadarScrubFrame = {
  path: string;
  time: number;
  targetUtcSec?: number;
  translate?: [number, number];
  hourKey?: string;
};

export type HybridRainHourlyStripProps = {
  lat: number;
  lon: number;
  product: 'krabi' | 'samui';
  forecastRows: SamuiWeatherForecastRow[];
  windDirDeg?: number;
  radarScrub?: HybridRadarScrubFrame | null;
  onRadarScrub?: (frame: HybridRadarScrubFrame | null) => void;
  onRadarOverlayUrl?: (url: string | null) => void;
  layout: 'map' | 'drawer';
  className?: string;
  hideChrome?: boolean;
};

function richBarTooltipDrawer(
  bar: HybridRainBar,
  hourStartUtc: number,
  forecastRow: SamuiWeatherForecastRow | null,
): string {
  const h = bar.hybrid;
  const off = h?.offset ?? 0;
  const offLabel = off === 0 ? 'Now' : off > 0 ? `T+${off}h` : `T${off}h`;
  const clock = formatHourClockBangkok(hourStartUtc);
  const rainPct =
    forecastRow != null
      ? Math.round(rainChancePercentForRow(forecastRow))
      : Math.round(bar.hybrid?.modelRainPct ?? 0);
  const pwat = bar.forecast?.pwat;
  const pwatTxt = pwat != null && Number.isFinite(pwat) ? `${Math.round(pwat)} kg/m²` : '—';
  const precipMm =
    forecastRow != null && Number.isFinite(forecastRow.precip)
      ? `${forecastRow.precip.toFixed(1)} mm`
      : '—';
  let windLine = '';
  if (
    forecastRow != null &&
    Number.isFinite(forecastRow.windDir) &&
    Number.isFinite(forecastRow.windSpeed)
  ) {
    windLine = ` • Wind: ${formatWindKmHFromRow(forecastRow.windSpeed, forecastRow.windDir)}`;
  }
  return `${offLabel} • ${clock} ICT • ${precipMm}${windLine} • ${rainPct}% chance of rain • PWAT ${pwatTxt}`;
}

export default function HybridRainHourlyStrip({
  lat,
  lon,
  product,
  forecastRows,
  radarScrub = null,
  onRadarScrub,
  onRadarOverlayUrl,
  windDirDeg: _windDirDeg = 0,
  layout,
  className,
  hideChrome = false,
}: HybridRainHourlyStripProps) {
  const stripPast =
    layout === 'map' ? MAP_STRIP_PAST_HOURS : HYBRID_STRIP_PAST_COUNT;
  const stripFuture =
    layout === 'map' ? MAP_STRIP_FUTURE_HOURS : HYBRID_STRIP_FUTURE_COUNT;

  const { frames, nowcastFrames, status } = useRadarFeed();
  const framesRef = useRef<RadarFrame[]>(frames);
  const nowcastRef = useRef<RadarFrame[]>(nowcastFrames);
  framesRef.current = frames;
  nowcastRef.current = nowcastFrames;

  const feedSig = useMemo(
    () =>
      `${frames.map((f) => f.time).join(',')}#${nowcastFrames.map((f) => f.time).join(',')}`,
    [frames, nowcastFrames],
  );
  const feedSigRef = useRef(feedSig);
  feedSigRef.current = feedSig;

  const mergedFrames = useMemo(
    () => mergeRadarFrames(frames, nowcastFrames),
    [frames, nowcastFrames],
  );
  const mergedFramesRef = useRef(mergedFrames);
  mergedFramesRef.current = mergedFrames;

  const [buckets, setBuckets] = useState<HourBucketRadar[]>([]);
  const bucketsRef = useRef(buckets);
  bucketsRef.current = buckets;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentHourIndex, setCurrentHourIndex] = useState(stripPast);
  const playIdxRef = useRef(0);

  const totalHours = buckets.length;
  const latLonRef = useRef({ lat, lon });
  latLonRef.current = { lat, lon };

  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const [tabVisible, setTabVisible] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'visible',
  );

  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    setCurrentHourIndex(stripPast);
  }, [stripPast, layout]);

  useEffect(() => {
    const merged = mergeRadarFrames(framesRef.current, nowcastRef.current);
    const nowSec = Math.floor(Date.now() / 1000);
    const hourStarts = bangkokWindowHourStarts(nowSec, stripPast, stripFuture);
    const rangeStart = hourStarts[0]!;
    const rangeEnd = hourStarts[hourStarts.length - 1]! + 3600;
    const inWindowAll = merged.filter((f) => f.time >= rangeStart && f.time < rangeEnd);

    if (inWindowAll.length === 0) {
      setBuckets(buildHourlyRadarBuckets(hourStarts, [], new Map()));
      setBusy(false);
      return;
    }

    const seen = new Set<number>();
    const toSample: (typeof inWindowAll)[number][] = [];
    for (const hs of hourStarts) {
      const f = pickLatestFrameInHour(inWindowAll, hs);
      if (f && !seen.has(f.time)) {
        seen.add(f.time);
        toSample.push(f);
      }
    }

    if (toSample.length === 0) {
      setBuckets(buildHourlyRadarBuckets(hourStarts, inWindowAll, new Map()));
      setBusy(false);
      return;
    }

    const ac = new AbortController();
    const runId = ++seq.current;
    setBusy(true);

    void (async () => {
      const sampleByFrameTime = new Map<number, 0 | 1>();
      for (const f of toSample) {
        if (ac.signal.aborted) return;
        const s = await sampleRadarEchoNearPin(lat, lon, f.path, ac.signal, product, 'timeline');
        sampleByFrameTime.set(f.time, s === 'precip' ? 1 : 0);
        await yieldToMap();
      }
      if (ac.signal.aborted || runId !== seq.current) return;
      setBuckets(buildHourlyRadarBuckets(hourStarts, inWindowAll, sampleByFrameTime));
      setBusy(false);
    })();

    return () => ac.abort();
  }, [feedSig, lat, lon, product, stripPast, stripFuture]);

  const onRadarScrubRef = useRef(onRadarScrub);
  const onRadarOverlayUrlRef = useRef(onRadarOverlayUrl);
  onRadarScrubRef.current = onRadarScrub;
  onRadarOverlayUrlRef.current = onRadarOverlayUrl;

  useEffect(() => {
    if (layout !== 'map' || !isPlaying || totalHours === 0 || !tabVisible) return;
    const scrub = onRadarScrubRef.current;
    if (!scrub) return;

    const pushHour = (idx: number) => {
      const bs = bucketsRef.current;
      const n = bs.length;
      if (n === 0) return;
      const i = ((idx % n) + n) % n;
      const b = bs[i];
      if (!b) return;

      const nowSec = Math.floor(Date.now() / 1000);
      const anchor = hybridStripAnchorHourStartUtc(nowSec);
      const frame = resolveHourRadarFrame(
        mergedFramesRef.current,
        nowcastRef.current,
        b.hourStartUtc,
        anchor,
      );

      if (frame && scrub) {
        scrub({
          path: frame.path,
          time: frame.time,
          targetUtcSec: b.hourStartUtc + 1800,
          translate: [0, 0],
          hourKey: b.key,
        });
        const { lat: la, lon: lo } = latLonRef.current;
        const url = getOverlayUrlForIndex(i, {
          buckets: bs,
          mergedFrames: mergedFramesRef.current,
          nowcastFrames: nowcastRef.current,
          lat: la,
          lon: lo,
          feedSig: feedSigRef.current,
          anchorHourStartUtc: anchor,
          stripPastCount: stripPast,
        });
        onRadarOverlayUrlRef.current?.(url);
      } else {
        scrub?.(null);
        onRadarOverlayUrlRef.current?.(null);
      }
      playIdxRef.current = i;
    };

    playIdxRef.current = stripPast;
    setCurrentHourIndex(stripPast);
    pushHour(stripPast);

    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const n = bucketsRef.current.length;
      if (n === 0) return;
      const next = (playIdxRef.current + 1) % n;
      playIdxRef.current = next;
      setCurrentHourIndex(next);
      pushHour(next);
    }, PLAY_MS);

    return () => clearInterval(id);
  }, [isPlaying, layout, totalHours, feedSig, tabVisible, stripPast]);

  const hybridHours = useMemo(() => {
    if (buckets.length === 0) return [];
    return buildHybridTimeline(
      buckets.map((b) => b.hourStartUtc),
      buckets,
      forecastRows,
      stripPast,
    );
  }, [buckets, forecastRows, stripPast]);

  const nowSecForHour = Math.floor(Date.now() / 1000);
  const nowKey = hourBucketKeyBangkok(nowSecForHour);
  const currentBangkokHourStartUtc = bangkokWindowHourStarts(nowSecForHour, 0, 0)[0]!;

  const hybridBarData = useMemo((): HybridRainBar[] => {
    if (buckets.length === 0) return [];
    const anchor = hybridStripAnchorHourStartUtc(nowSecForHour);
    return buckets.map((b, i) => {
      const hybrid = hybridHours[i] ?? null;
      const forecastRow = findForecastRowNearHour(forecastRows, b.hourStartUtc);
      return {
        index: i,
        bucket: b,
        hybrid,
        forecast: toSpireForecastFrame(forecastRow),
        radarFrame: resolveHourRadarFrame(mergedFrames, nowcastFrames, b.hourStartUtc, anchor),
      };
    });
  }, [buckets, hybridHours, forecastRows, mergedFrames, nowcastFrames, nowKey, feedSig]);

  const bucketKeysStr = useMemo(() => buckets.map((b) => b.key).join('|'), [buckets]);

  const activeHudBarIndex = useMemo(() => {
    if (layout !== 'map') return -1;
    if (isPlaying) return currentHourIndex;
    if (radarScrub?.hourKey) {
      const ix = buckets.findIndex((b) => b.key === radarScrub.hourKey);
      if (ix >= 0) return ix;
    }
    return stripPast;
  }, [layout, isPlaying, currentHourIndex, radarScrub?.hourKey, bucketKeysStr, stripPast]);

  const hudForecastRow = useMemo(() => {
    if (layout !== 'map' || activeHudBarIndex < 0 || activeHudBarIndex >= buckets.length) {
      return null;
    }
    const hb = buckets[activeHudBarIndex];
    if (!hb) return null;
    return findForecastRowNearHour(forecastRows, hb.hourStartUtc);
  }, [layout, activeHudBarIndex, buckets, forecastRows, bucketKeysStr]);

  const headline = useMemo(
    () => pickHybridHeadline(hybridHours, forecastRows),
    [hybridHours, forecastRows],
  );

  useEffect(() => {
    if (layout !== 'map') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      if (!onRadarScrub || buckets.length === 0) return;
      if (isPlaying) {
        setIsPlaying(false);
        onRadarScrub(null);
        onRadarOverlayUrl?.(null);
      } else {
        setIsPlaying(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout, onRadarScrub, onRadarOverlayUrl, buckets.length, isPlaying]);

  if (status === 'error' && frames.length === 0 && nowcastFrames.length === 0) return null;

  const barMinH = layout === 'drawer' ? '2.35rem' : '3rem';
  const barBtnH = layout === 'drawer' ? 'h-10' : 'h-12';
  const gapClass = layout === 'drawer' ? 'gap-0.5' : 'gap-0.5 sm:gap-1';

  return (
    <div className={className ?? ''}>
      {layout === 'map' && (
        <div className="mb-1.5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={!onRadarScrub || buckets.length === 0}
            onClick={() => {
              if (isPlaying) {
                setIsPlaying(false);
                onRadarScrub?.(null);
                onRadarOverlayUrl?.(null);
              } else {
                setIsPlaying(true);
              }
            }}
            aria-pressed={isPlaying}
            aria-label={
              isPlaying
                ? 'RainPlayer on — stop and return to live radar'
                : 'RainPlayer off — replay last 3 hours + now'
            }
            title={
              isPlaying
                ? 'Stop — live radar (Space)'
                : 'Play — step through recent RainViewer scans (Space)'
            }
            className={[
              'rounded-lg px-3 py-1 text-[9px] font-black uppercase tracking-widest shadow-md transition-colors',
              isPlaying
                ? 'bg-emerald-600 text-white ring-1 ring-emerald-400/80 hover:bg-emerald-500'
                : 'bg-slate-600/90 text-slate-200 ring-1 ring-slate-500/50 hover:bg-slate-600',
              !onRadarScrub || buckets.length === 0 ? 'cursor-not-allowed opacity-45' : '',
            ].join(' ')}
          >
            RainPlayer
          </button>
          {hudForecastRow != null &&
            Number.isFinite(hudForecastRow.windDir) &&
            Number.isFinite(hudForecastRow.windSpeed) && (
              <div className="flex max-w-[10rem] items-center gap-1 rounded-lg border border-cyan-500/30 bg-slate-950/85 px-2 py-0.5 shadow-md backdrop-blur-sm">
                <ArrowUp
                  className="h-3 w-3 shrink-0 text-cyan-200"
                  strokeWidth={2.5}
                  aria-hidden
                  style={{
                    transform: `rotate(${(hudForecastRow.windDir + 180 + 360) % 360}deg)`,
                  }}
                />
                <span className="font-mono text-[9px] font-semibold tabular-nums text-cyan-50/95">
                  {formatWindKmHFromRow(hudForecastRow.windSpeed, hudForecastRow.windDir)}
                </span>
              </div>
            )}
        </div>
      )}

      {!hideChrome && layout === 'drawer' && (
        <>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[8px] font-black uppercase tracking-wider text-sky-200/85">
              Next 18 hours · radar + forecast
            </span>
            {busy && <span className="text-[8px] text-slate-500">Loading…</span>}
          </div>
          <p className="mb-1.5 text-[8px] leading-snug text-slate-200/90">{headline}</p>
          <p className="mb-2 text-[7.5px] leading-snug text-slate-500">
            Colours run light blue → red as rain builds. Arrow → building, ← easing. % = confidence
            (100% now → ~30% at +18h). First hours lean on live radar; later on the forecast.
            {onRadarScrub && ' Tap a bar to match the map to that hour.'}
          </p>
        </>
      )}

      <div className={`relative flex ${gapClass}`}>
        {hybridBarData.map((bar) => {
          const { bucket: b, index: i } = bar;
          const h = bar.hybrid;
          const isNow = b.key === nowKey;
          const frameInHour = pickScrubFrameForHour(
            mergedFrames,
            nowcastFrames,
            b.hourStartUtc,
            currentBangkokHourStartUtc,
          );
          const forecastRow = findForecastRowNearHour(forecastRows, b.hourStartUtc);
          const off = stripBarIndexToClockOffset(i, stripPast);
          const canScrubDrawer = Boolean(onRadarScrub);
          const isMap = layout === 'map';
          const isSelected = isMap
            ? isPlaying && currentHourIndex === i
            : currentHourIndex === i ||
              (radarScrub != null &&
                (radarScrub.hourKey === b.key ||
                  (radarScrub.hourKey == null &&
                    frameInHour != null &&
                    radarScrub.path === frameInHour.path &&
                    radarScrub.time === frameInHour.time)));
          const barStyle = h
            ? { ...hybridBarStyle(h.intensity), minHeight: barMinH }
            : { minHeight: barMinH };
          const layer = h?.layer ?? 'radar';
          const trend = h?.trend ?? 'flat';
          const rel = h?.reliabilityPct ?? 100;
          const modelPct = h?.modelRainPct;
          const rainLbl = h?.rainLabel ?? 'Passing';
          const rainLine = `${rainLbl} rain around ${formatHourClockBangkok(b.hourStartUtc)} ICT`;
          const hintTitle = h
            ? `${rainLine}. About ${rel}% confidence.${
                modelPct != null && modelPct > 0 ? ` Rain chance ~${modelPct}%.` : ''
              } ${layerHintEn(h.layer)} Full: ${formatHourTooltip(b.hourStartUtc)}.`
            : formatHourTooltip(b.hourStartUtc);
          const drawerTip = richBarTooltipDrawer(bar, b.hourStartUtc, forecastRow);
          const mapTip = mapBarTooltipLines(b.hourStartUtc, forecastRow);
          const stormy = !isMap && (bar.forecast?.cape ?? 0) > 2000;

          return (
            <div
              key={b.key}
              className={[
                'relative z-0 flex min-w-0 flex-1 flex-col items-center gap-0.5',
                isNow ? 'z-[1]' : '',
              ].join(' ')}
            >
              {isNow && (
                <span
                  className="pointer-events-none absolute -left-px -right-px top-0 bottom-0 z-0 rounded-md border-x-2 border-cyan-400/90 bg-gradient-to-b from-cyan-400/12 to-transparent shadow-[0_0_14px_rgba(34,211,238,0.35)]"
                  aria-hidden
                />
              )}
              {!isMap && (
                <div
                  className="relative z-[1] flex h-3 w-full max-w-[2.65rem] items-end justify-center text-[8px] leading-none text-cyan-100/80 sm:h-3.5 sm:max-w-[2.85rem] sm:text-[9px]"
                  aria-hidden
                >
                  {trend === 'in' && <span title="Rain building">→</span>}
                  {trend === 'out' && <span title="Rain easing">←</span>}
                </div>
              )}
              {isMap ? (
                <div
                  role="img"
                  aria-hidden
                  title={mapTip}
                  style={barStyle as CSSProperties}
                  className={[
                    'relative z-[1] overflow-hidden transition-[box-shadow,transform] duration-200',
                    `${barBtnH} w-full max-w-[2.65rem] rounded-md sm:max-w-[2.85rem]`,
                    h ? layerRingClass(layer) : 'border border-dashed border-slate-600/80 bg-slate-900/40',
                    isNow && !isPlaying && radarScrub === null ? 'ring-2 ring-cyan-400/70' : '',
                    isSelected ? 'scale-[1.04] ring-2 ring-amber-400/90 ring-offset-1 ring-offset-slate-950 shadow-[0_0_18px_rgba(251,191,36,0.45)]' : '',
                    busy ? 'opacity-60' : '',
                    !h ? 'opacity-80' : '',
                  ].join(' ')}
                />
              ) : (
                <button
                  type="button"
                  disabled={!canScrubDrawer}
                  onClick={() => {
                    if (isPlaying) setIsPlaying(false);
                    setCurrentHourIndex(i);
                    playIdxRef.current = i;
                    if (!onRadarScrub) return;
                    if (off <= 0 && frameInHour) {
                      onRadarScrub({
                        path: frameInHour.path,
                        time: frameInHour.time,
                        targetUtcSec: b.hourStartUtc + 1800,
                        translate: [0, 0],
                        hourKey: b.key,
                      });
                      const nowSec = Math.floor(Date.now() / 1000);
                      const anchor = hybridStripAnchorHourStartUtc(nowSec);
                      const url = getOverlayUrlForIndex(i, {
                        buckets,
                        mergedFrames,
                        nowcastFrames,
                        lat,
                        lon,
                        feedSig,
                        anchorHourStartUtc: anchor,
                        stripPastCount: stripPast,
                      });
                      onRadarOverlayUrl?.(url);
                    } else {
                      onRadarScrub(null);
                      onRadarOverlayUrl?.(null);
                    }
                  }}
                  title={`${drawerTip}\n${hintTitle}`}
                  style={barStyle as CSSProperties}
                  className={[
                    'relative z-[1]',
                    `${barBtnH} w-full max-w-[2.65rem] rounded-md transition-[filter,opacity] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 sm:max-w-[2.85rem]`,
                    h ? layerRingClass(layer) : 'border border-dashed border-slate-600/80 bg-slate-900/40',
                    isNow && radarScrub === null ? 'ring-2 ring-cyan-400/70' : '',
                    isSelected ? 'ring-2 ring-amber-400/90 ring-offset-1 ring-offset-slate-950' : '',
                    busy ? 'opacity-60' : '',
                    canScrubDrawer ? 'cursor-pointer hover:brightness-110' : 'cursor-default',
                    !h && !canScrubDrawer ? 'opacity-80' : '',
                  ].join(' ')}
                >
                  {stormy && (
                    <span
                      className="pointer-events-none absolute right-0.5 top-0.5 z-[2] text-[9px] leading-none drop-shadow-md"
                      title="High CAPE — convective risk"
                    >
                      ⚡
                    </span>
                  )}
                </button>
              )}
              <span
                className={[
                  'relative z-[1] text-[7px] font-bold tabular-nums sm:text-[8px]',
                  isNow ? 'text-cyan-300' : 'text-slate-500',
                  isSelected ? 'text-amber-200' : '',
                ].join(' ')}
              >
                {formatHourLabelBangkok(b.hourStartUtc, isNow)}
              </span>
              {!isMap && (
                <>
                  <span className="relative z-[1] text-[6.5px] font-semibold tabular-nums text-slate-400 sm:text-[7px]">
                    {rel}%
                  </span>
                  {h && (
                    <span
                      className="relative z-[1] max-w-[3rem] text-center text-[5px] font-bold uppercase leading-tight tracking-tight text-slate-500 sm:max-w-[3.1rem] sm:text-[5.5px]"
                      title={rainLbl}
                    >
                      {RAIN_LABEL_COMPACT[rainLbl]}
                    </span>
                  )}
                </>
              )}
              {forecastRow != null &&
                Number.isFinite(forecastRow.windDir) &&
                Number.isFinite(forecastRow.windSpeed) && (
                  <span
                    className="relative z-[1] flex h-3.5 items-center justify-center"
                    title={
                      isMap
                        ? mapTip
                        : `${formatWindKmHFromRow(forecastRow.windSpeed, forecastRow.windDir)}`
                    }
                  >
                    <ArrowUp
                      className="h-2 w-2 text-slate-400"
                      strokeWidth={2}
                      aria-hidden
                      style={{
                        transform: `rotate(${(forecastRow.windDir + 180 + 360) % 360}deg)`,
                      }}
                    />
                  </span>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
