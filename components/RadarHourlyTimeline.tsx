'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRadarFeed } from './RadarFramesProvider';
import type { RadarFrame } from './RadarFramesProvider';
import { sampleRadarEchoNearPin } from '@/lib/rainviewer-tile-sample';
import {
  bangkokWindowHourStarts,
  buildHourlyRadarBuckets,
  hourBucketKeyBangkok,
  mergeRadarFrames,
  pickScrubFrameForHour,
  type HourBucketRadar,
} from '@/lib/radar-hourly-buckets';

const MAX_FRAMES_PER_RUN = 14;
const YIELD_MS = 48;

function yieldToMap(): Promise<void> {
  return new Promise((r) => window.setTimeout(r, YIELD_MS));
}

function formatHourLabel(utcSec: number): string {
  const h = new Date(utcSec * 1000).toLocaleString('en-US', {
    timeZone: 'Asia/Bangkok',
    hour:     'numeric',
    hour12:   false,
  });
  return `${h}u`;
}

function formatHourTooltip(utcSec: number): string {
  return new Date(utcSec * 1000).toLocaleString('nl-NL', {
    timeZone: 'Asia/Bangkok',
    weekday:  'short',
    day:      'numeric',
    month:    'short',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  });
}

export type RadarScrubFrame = { path: string; time: number };

export default function RadarHourlyTimeline({
  lat,
  lon,
  product,
  className,
  radarScrub = null,
  onRadarScrub,
}: {
  lat: number;
  lon: number;
  product: 'krabi' | 'samui';
  className?: string;
  /** Map overlay — `null` = nieuwste scan (live). */
  radarScrub?: RadarScrubFrame | null;
  onRadarScrub?: (frame: RadarScrubFrame | null) => void;
}) {
  const { frames, nowcastFrames, status } = useRadarFeed();
  const framesRef = useRef<RadarFrame[]>(frames);
  const nowcastRef = useRef<RadarFrame[]>(nowcastFrames);
  framesRef.current = frames;
  nowcastRef.current = nowcastFrames;

  /** Re-run only when scan times change — avoids effect storms on context reference churn. */
  const feedSig = useMemo(
    () =>
      `${frames.map((f) => f.time).join(',')}#${nowcastFrames.map((f) => f.time).join(',')}`,
    [frames, nowcastFrames],
  );

  const mergedFrames = useMemo(
    () => mergeRadarFrames(frames, nowcastFrames),
    [frames, nowcastFrames],
  );

  const [buckets, setBuckets] = useState<HourBucketRadar[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const merged = mergeRadarFrames(framesRef.current, nowcastRef.current);
    const nowSec = Math.floor(Date.now() / 1000);
    const ncLen = nowcastRef.current.length;
    const hourStarts = bangkokWindowHourStarts(nowSec, 2, ncLen > 0 ? 5 : 0);
    const rangeStart = hourStarts[0]!;
    const rangeEnd = hourStarts[hourStarts.length - 1]! + 3600;
    const inWindowAll = merged.filter((f) => f.time >= rangeStart && f.time < rangeEnd);
    const sorted = [...inWindowAll].sort((a, b) => a.time - b.time);
    const inWindow =
      sorted.length <= MAX_FRAMES_PER_RUN
        ? sorted
        : sorted.slice(sorted.length - MAX_FRAMES_PER_RUN);

    if (inWindow.length === 0) {
      setBuckets(buildHourlyRadarBuckets(hourStarts, [], new Map()));
      setBusy(false);
      return;
    }

    const ac = new AbortController();
    const runId = ++seq.current;
    setBusy(true);

    void (async () => {
      const sampleByFrameTime = new Map<number, 0 | 1>();
      for (const f of inWindow) {
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
  }, [feedSig, lat, lon, product]);

  const nowSecForHour = Math.floor(Date.now() / 1000);
  const nowKey = hourBucketKeyBangkok(nowSecForHour);
  const currentBangkokHourStartUtc = bangkokWindowHourStarts(nowSecForHour, 0, 0)[0]!;

  if (status === 'error' && frames.length === 0 && nowcastFrames.length === 0) return null;

  return (
    <div
      className={[
        'pointer-events-auto rounded-xl border border-cyan-500/25 bg-slate-950/92 px-2 py-2 shadow-xl backdrop-blur-md sm:px-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role="region"
      aria-label="Radar per uur op jouw pin (ICT)"
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[9px] font-black uppercase tracking-wider text-cyan-200/95">
          Radar · uren (Bangkok)
        </span>
        <div className="flex items-center gap-2">
          {busy && (
            <span className="text-[8px] font-semibold text-slate-500">Scans lezen…</span>
          )}
          <button
            type="button"
            disabled={busy || !onRadarScrub}
            onClick={() => onRadarScrub?.(null)}
            className={[
              'rounded-md px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide transition-colors',
              radarScrub === null
                ? 'bg-cyan-500/25 text-cyan-200 ring-1 ring-cyan-400/60'
                : 'bg-slate-800/90 text-slate-400 hover:bg-slate-700/90 hover:text-slate-200',
              busy || !onRadarScrub ? 'cursor-not-allowed opacity-50' : '',
            ].join(' ')}
          >
            Live
          </button>
        </div>
      </div>
      <p className="mb-2 text-[8px] leading-snug text-slate-500">
        Kleur = echo op je pin. Tik een uur om die radarscan op de kaart te tonen. Live = nieuwste
        sweep. Uren vooruit alleen bij RainViewer-nowcast; anders tonen we alleen ~2 uur historie +
        nu.
      </p>
      <div className="flex gap-1 sm:gap-1.5">
        {buckets.map((b) => {
          const isNow = b.key === nowKey;
          const frameInHour = pickScrubFrameForHour(
            mergedFrames,
            nowcastFrames,
            b.hourStartUtc,
            currentBangkokHourStartUtc,
          );
          const canScrub = Boolean(frameInHour && onRadarScrub && !busy);
          const isSelected =
            radarScrub != null &&
            frameInHour != null &&
            radarScrub.path === frameInHour.path;
          const barClass =
            b.level === 1
              ? 'bg-gradient-to-t from-sky-700 via-amber-500 to-rose-500 shadow-[0_0_12px_rgba(251,191,36,0.35)]'
              : b.level === 0
                ? 'bg-slate-800/90'
                : 'border border-dashed border-slate-600/80 bg-slate-900/40';
          const hintBase =
            b.level === 1
              ? 'Neerslag op pin / nabij'
              : b.level === 0
                ? 'Geen echo op pin / nabij (in beschikbare scans)'
                : 'Geen radarscan in dit uur';
          const scrubHint = canScrub ? ' — klik: deze scan op de kaart' : '';
          return (
            <div key={b.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <button
                type="button"
                disabled={!canScrub}
                onClick={() => {
                  if (frameInHour && onRadarScrub) {
                    onRadarScrub({ path: frameInHour.path, time: frameInHour.time });
                  }
                }}
                title={`${formatHourTooltip(b.hourStartUtc)} — ${hintBase}${scrubHint}`}
                className={[
                  'h-11 w-full max-w-[3.5rem] rounded-md transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80',
                  barClass,
                  isNow && radarScrub === null ? 'ring-1 ring-cyan-400/70' : '',
                  isSelected ? 'ring-2 ring-amber-400/90 ring-offset-1 ring-offset-slate-950' : '',
                  busy ? 'opacity-60' : '',
                  canScrub ? 'cursor-pointer hover:brightness-110' : 'cursor-default',
                  !canScrub ? 'opacity-80' : '',
                ].join(' ')}
              />
              <span
                className={[
                  'text-[8px] font-bold tabular-nums',
                  isNow ? 'text-cyan-300' : 'text-slate-500',
                  isSelected ? 'text-amber-200' : '',
                ].join(' ')}
              >
                {isNow ? 'Nu' : formatHourLabel(b.hourStartUtc)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
