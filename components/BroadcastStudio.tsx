'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BroadcastScript, BroadcastSlot, PresenterPose } from '@/lib/broadcast-script';
import { getDashboardRegion } from '@/lib/dashboard-regions';
import { HOLIDAY_MAP_FOOTER_LINE } from '@/lib/holiday-now-hints';

const SamuiExploreMap = dynamic(() => import('./SamuiExploreMap'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#d4d2ce]" aria-hidden />,
});

function poseClass(pose: PresenterPose): string {
  if (pose === 'hands-folded') return 'origin-bottom scale-105';
  if (pose === 'point-south') return 'translate-x-4 translate-y-2';
  if (pose === 'point-chaweng' || pose === 'point-east') return 'translate-x-2';
  return '';
}

function poseLoop(pose: PresenterPose): string {
  if (pose === 'point-east') return '/broadcast/sammi/loops/point-east.mp4';
  if (pose === 'point-chaweng') return '/broadcast/sammi/loops/point-chaweng.mp4';
  return '/broadcast/sammi/loops/present.mp4';
}

function flyZoom(actId: string): number {
  if (actId === 'synoptic') return 9.6;
  if (actId === 'open' || actId === 'now') return 10.4;
  if (actId === 'rain') return 12.4;
  if (actId === 'evening' || actId === 'close') return 13.4;
  return 13.2;
}

export default function BroadcastStudio({
  slot,
  autoplay,
}: {
  slot: BroadcastSlot;
  autoplay: boolean;
}) {
  const region = getDashboardRegion('samui');
  const [script, setScript] = useState<BroadcastScript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [overlayReady, setOverlayReady] = useState(false);
  const [actIndex, setActIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const [flyToRequest, setFlyToRequest] = useState<{
    key: number;
    lng: number;
    lat: number;
    zoom?: number;
  } | null>(null);

  const onMapReady = useCallback(() => setMapReady(true), []);
  const onWeatherOverlayReady = useCallback(() => setOverlayReady(true), []);

  useEffect(() => {
    if (!mapReady) return;
    const t = window.setTimeout(() => setOverlayReady(true), 8000);
    return () => window.clearTimeout(t);
  }, [mapReady]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/broadcast/script?slot=${slot}`, { cache: 'no-store' })
      .then(async (r) => {
        const json = (await r.json()) as BroadcastScript & { error?: string };
        if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
        if (!cancelled) setScript(json);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'script failed');
      });
    return () => {
      cancelled = true;
    };
  }, [slot]);

  const ready = Boolean(script) && mapReady && overlayReady;
  const act = script?.acts[actIndex] ?? null;

  useEffect(() => {
    if (!mapReady || !act?.flyTo) return;
    setFlyToRequest({
      key: Date.now(),
      lng: act.flyTo.lon,
      lat: act.flyTo.lat,
      zoom: flyZoom(act.id),
    });
  }, [mapReady, act?.id, act?.flyTo]);

  useEffect(() => {
    if (!autoplay || !ready || !script || playing || done) return;
    setPlaying(true);
    setActIndex(0);
  }, [autoplay, ready, script, playing, done]);

  useEffect(() => {
    if (!playing || !script) return;
    const current = script.acts[actIndex];
    if (!current) {
      setPlaying(false);
      setDone(true);
      return;
    }
    const t = window.setTimeout(() => {
      setActIndex((i) => i + 1);
    }, current.durationSec * 1000);
    return () => window.clearTimeout(t);
  }, [playing, script, actIndex]);

  const homePins = useMemo(
    () =>
      region.homePins?.map((p) => ({
        lat: p.lat,
        lng: p.lon,
        label: p.label,
        area: p.area,
        badge: p.badge,
      })) ?? null,
    [region.homePins],
  );

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[#020617]"
      data-studio-ready={ready ? 'true' : 'false'}
      data-studio-playing={playing ? 'true' : 'false'}
      data-studio-done={done ? 'true' : 'false'}
      data-act-id={act?.id ?? ''}
    >
      <div className="absolute inset-0 z-0">
        <SamuiExploreMap
          flyToRequest={flyToRequest}
          initialLongitude={region.lon + region.lngOffset}
          initialLatitude={region.lat + region.latOffset}
          initialZoom={region.mapZoom}
          showIslandPois
          homeLocationPins={homePins}
          mapScaleContextLabel="island"
          mapFooterHolidayLine={HOLIDAY_MAP_FOOTER_LINE}
          hideHud
          weatherOverlayEnabled
          onWeatherOverlayReady={onWeatherOverlayReady}
          onMapReady={onMapReady}
        />
      </div>

      {act && (
        <video
          key={act.pose}
          src={poseLoop(act.pose)}
          poster="/broadcast/sammi/cutout.png"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden
          className={[
            'pointer-events-none absolute bottom-0 left-[4%] z-20 h-[90%] w-auto max-w-[46%] object-contain object-bottom mix-blend-screen drop-shadow-[0_12px_24px_rgba(0,0,0,0.45)] transition-transform duration-700',
            poseClass(act.pose),
          ].join(' ')}
        />
      )}

      {act && script && (
        <div className="pointer-events-none absolute right-6 top-8 z-30 flex w-[min(16rem,38%)] flex-col gap-2">
          {script.lowerThird.subtitle.split(' · ').slice(0, 2).map((chip) => (
            <div
              key={chip}
              className="rounded-lg border border-cyan-300/40 bg-slate-950/80 px-3 py-2 text-[15px] font-bold text-cyan-50 shadow-lg backdrop-blur-sm"
            >
              {chip}
            </div>
          ))}
          {act.id === 'synoptic' && (
            <div className="rounded-lg border border-sky-300/50 bg-sky-950/80 px-3 py-2 text-[14px] font-semibold text-sky-50 shadow-lg">
              East / Gulf · Vietnam feed
            </div>
          )}
          {act.id === 'rain' && (
            <div className="rounded-lg border border-amber-300/50 bg-amber-950/80 px-3 py-2 text-[14px] font-semibold text-amber-50 shadow-lg">
              Radar showers · Lamai clock
            </div>
          )}
          {(act.id === 'open' || act.id === 'evening' || act.id === 'close') && (
            <div className="rounded-lg border border-emerald-300/40 bg-emerald-950/80 px-3 py-2 text-[14px] font-semibold text-emerald-50 shadow-lg">
              Wind · isobars · sun
            </div>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-24 left-6 z-30">
        <div className="rounded-full bg-cyan-500 px-4 py-1.5 text-[13px] font-bold text-slate-950 shadow-lg">
          Sammi · Samui Weather
        </div>
      </div>

      {script && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-slate-950/95 via-slate-950/80 to-transparent px-6 pb-5 pt-16">
          <p className="text-[28px] font-black leading-tight tracking-tight text-white">
            {script.lowerThird.title}
          </p>
          <p className="mt-1 text-[16px] font-semibold text-cyan-100/90">
            {script.lowerThird.subtitle}
          </p>
          {act && (
            <p className="mt-3 max-w-3xl text-[15px] leading-snug text-white/90">{act.caption}</p>
          )}
          <p className="absolute bottom-5 right-6 text-[11px] font-semibold tracking-wide text-white/50">
            map: samuiweather.com
          </p>
        </div>
      )}

      {error && (
        <div className="absolute left-4 top-4 z-40 rounded-md border border-amber-500/40 bg-amber-950/90 px-3 py-2 text-xs text-amber-100">
          {error}
        </div>
      )}
    </div>
  );
}
