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
  if (pose === 'stand-right') return '-scale-x-100';
  if (pose === 'hands-folded') return 'origin-bottom scale-110';
  if (pose === 'point-south') return 'translate-y-3';
  return '';
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

  const ready = Boolean(script) && mapReady;
  const act = script?.acts[actIndex] ?? null;

  useEffect(() => {
    if (!mapReady || !act?.flyTo) return;
    setFlyToRequest({
      key: Date.now(),
      lng: act.flyTo.lon,
      lat: act.flyTo.lat,
      zoom: act.id === 'open' || act.id === 'now' ? 11 : 13.2,
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
          onMapReady={onMapReady}
        />
      </div>

      {act && (
        <img
          src="/broadcast/sammi/cutout.png"
          alt=""
          className={[
            'pointer-events-none absolute bottom-0 left-[8%] z-20 h-[88%] w-auto max-w-[42%] object-contain object-bottom drop-shadow-[0_12px_24px_rgba(0,0,0,0.45)] transition-transform duration-700',
            poseClass(act.pose),
          ].join(' ')}
        />
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
