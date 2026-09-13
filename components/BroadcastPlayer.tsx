'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  shouldInsertHourlyBumper,
  type BroadcastLatest,
} from '@/lib/broadcast-catalog';

export default function BroadcastPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [latest, setLatest] = useState<BroadcastLatest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingKind, setPlayingKind] = useState<'feature' | 'hourly'>('feature');
  const [muted, setMuted] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const hourlyPlayedThisHour = useRef<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/broadcast/latest', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<BroadcastLatest>;
      })
      .then((d) => {
        setLatest(d);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'latest failed');
      });
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const feature = latest?.feature ?? null;
  const hourly = latest?.hourlyIsFresh ? latest.hourly : null;
  const src = playingKind === 'hourly' && hourly ? hourly.url : feature?.url ?? null;
  const captions =
    playingKind === 'hourly' && hourly
      ? hourly.captionsUrl
      : feature?.captionsUrl ?? null;

  useEffect(() => {
    if (!latest) return;
    const tick = () => {
      const now = Date.now();
      const hourKey = new Date(now).toISOString().slice(0, 13);
      if (
        shouldInsertHourlyBumper(latest, now) &&
        hourlyPlayedThisHour.current !== hourKey &&
        playingKind !== 'hourly'
      ) {
        hourlyPlayedThisHour.current = hourKey;
        setPlayingKind('hourly');
      }
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, [latest, playingKind]);

  const tryPlay = useCallback(async (withSound: boolean) => {
    const el = videoRef.current;
    if (!el || !src) return;
    el.volume = 1;
    el.muted = !withSound;
    try {
      await el.play();
      setMuted(!withSound);
      setNeedsGesture(false);
    } catch {
      if (withSound) {
        el.muted = true;
        try {
          await el.play();
          setMuted(true);
          setNeedsGesture(true);
          return;
        } catch {
          /* fall through */
        }
      }
      setNeedsGesture(true);
    }
  }, [src]);

  useEffect(() => {
    void tryPlay(true);
  }, [tryPlay]);

  const onEnded = () => {
    if (playingKind === 'hourly') setPlayingKind('feature');
  };

  const startWithSound = () => {
    void tryPlay(true);
  };

  const delayed = latest?.delayed ?? !src;
  const title = latest?.feature?.lowerThird.title ?? 'Sammi · Samui Weather';
  const sub = latest?.feature?.lowerThird.subtitle ?? latest?.reason ?? 'Show delayed';

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#020617] text-white">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
            Sammi · Samui Weather
          </p>
          <p className="truncate text-sm font-bold">{title}</p>
          <p className="truncate text-[11px] text-slate-400">{sub}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {delayed && (
            <span className="rounded-full border border-amber-400/40 bg-amber-950/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-200">
              Show delayed
            </span>
          )}
          <Link
            href="/"
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-200 hover:bg-white/10"
          >
            Live map
          </Link>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 bg-black">
        {src ? (
          <video
            ref={videoRef}
            key={`${playingKind}:${src}`}
            className="h-full w-full bg-black object-contain"
            src={src}
            preload="auto"
            controls
            autoPlay
            playsInline
            loop={playingKind === 'feature'}
            onEnded={onEnded}
            onClick={startWithSound}
            onPlay={() => setNeedsGesture(false)}
          >
            {captions && (
              <track kind="captions" srcLang="en" label="English" src={captions} />
            )}
          </video>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-bold text-amber-100">Show delayed</p>
            <p className="max-w-md text-xs text-slate-400">
              {latest?.reason ?? error ?? 'No episode is on air. Use the live map for now.'}
            </p>
            <Link href="/" className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">
              Open live map
            </Link>
          </div>
        )}

        {src && (needsGesture || muted) && (
          <button
            type="button"
            onClick={startWithSound}
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/35"
          >
            <span className="rounded-full border border-white/25 bg-slate-950/90 px-6 py-3 text-sm font-black uppercase tracking-wider text-white shadow-xl">
              Play with sound
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
