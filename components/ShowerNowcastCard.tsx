'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { RadarEchoSample } from '../lib/rainviewer-tile-sample';
import type { SamuiWeatherForecastRow } from '../lib/spire';
import {
  buildShowerNowcastSchedule,
  comparePastEchoAtPin,
  compass16FromDeg,
  type ShowerNowcastRow,
} from '../lib/shower-nowcast-schedule';
import HybridRainHourlyStrip, { type HybridRadarScrubFrame } from './HybridRainHourlyStrip';

function fmtIctShort(timeUnix: number): string {
  return new Date(timeUnix * 1000).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function echoLabel(e: RadarEchoSample): string {
  if (e === 'precip') return 'Rain on map';
  if (e === 'none') return 'Dry';
  return '—';
}

export interface ShowerNowcastCardProps {
  latitude: number;
  longitude: number;
  windSpeedMs: number;
  windDirDeg: number;
  nowcastFrames: { path: string; time: number }[];
  pastFrames: { path: string; time: number }[];
  radarReady: boolean;
  rainPossibleNext6h: boolean;
  /** Spire + Sammi rows for the hybrid 3–12h part of the outlook */
  forecastRows: SamuiWeatherForecastRow[];
  product: 'samui' | 'krabi';
  /** Sync map scrub when user taps a bar (optional) */
  radarScrub?: HybridRadarScrubFrame | null;
  onRadarScrub?: (frame: HybridRadarScrubFrame | null) => void;
}

/**
 * Hybrid rain outlook: compact line when dry; radar+model 12h strip + wind when wet.
 */
export default function ShowerNowcastCard({
  latitude,
  longitude,
  windSpeedMs,
  windDirDeg,
  nowcastFrames,
  pastFrames,
  radarReady,
  rainPossibleNext6h,
  forecastRows,
  product,
  radarScrub = null,
  onRadarScrub,
}: ShowerNowcastCardProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ShowerNowcastRow[]>([]);
  const [pastDelta, setPastDelta] = useState<'arriving' | 'leaving' | 'steady' | 'unknown'>(
    'unknown',
  );

  const feedFingerprint = useMemo(
    () =>
      `${nowcastFrames.length}:${nowcastFrames[nowcastFrames.length - 1]?.time ?? 0}|${pastFrames.length}:${pastFrames[pastFrames.length - 1]?.time ?? 0}`,
    [nowcastFrames, pastFrames],
  );

  useEffect(() => {
    if (!radarReady || !rainPossibleNext6h) return;
    const ac = new AbortController();
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [delta, schedule] = await Promise.all([
          comparePastEchoAtPin(latitude, longitude, pastFrames, ac.signal),
          buildShowerNowcastSchedule(latitude, longitude, nowcastFrames, ac.signal),
        ]);
        if (!cancelled) {
          setPastDelta(delta);
          setRows(schedule);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [radarReady, rainPossibleNext6h, latitude, longitude, feedFingerprint]);

  const windFrom = compass16FromDeg(windDirDeg);
  const windKmh = Math.round(windSpeedMs * 3.6);

  const firstRainUnix = (() => {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]!.echo === 'precip') return rows[i]!.timeUnix;
    }
    return null;
  })();

  const firstClearAfterRainUnix = (() => {
    let sawRain = false;
    for (const r of rows) {
      if (r.echo === 'precip') sawRain = true;
      else if (sawRain && r.echo === 'none') return r.timeUnix;
    }
    return null;
  })();

  const nowcastUnavailable = !radarReady || nowcastFrames.length === 0;

  const statusLine = (() => {
    if (!rainPossibleNext6h) return null;
    if (!radarReady) return null;
    if (loading) return 'Taking a quick look at the map for you…';
    if (rows.length === 0 && !nowcastUnavailable) {
      return 'We could not read the short-range map just now — the live radar above still helps.';
    }
    if (pastDelta === 'arriving') {
      return 'Recent scans suggest showers may be drifting toward you — keep an eye on the sky.';
    }
    if (pastDelta === 'leaving') {
      return 'Recent scans suggest rain may be easing here.';
    }
    if (firstRainUnix != null) {
      return `The map hints at rain around your spot near ${fmtIctShort(firstRainUnix)} Thailand time — timing can shift, so stay flexible.`;
    }
    if (firstClearAfterRainUnix != null) {
      return `You might catch a clearer spell around ${fmtIctShort(firstClearAfterRainUnix)} Thailand time.`;
    }
    if (!nowcastUnavailable) {
      return 'No rain blob is heading straight for this pin in the next short steps — still glance at the live colors on the map.';
    }
    return null;
  })();

  return (
    <div
      className={[
        'relative overflow-hidden rounded-3xl border border-sky-500/25 bg-slate-900 shadow-[0_4px_32px_rgba(0,0,0,0.45)]',
        !rainPossibleNext6h ? 'py-2.5' : '',
      ].join(' ')}
    >
      <div className="pointer-events-none absolute -left-10 top-0 h-full w-24 rotate-12 bg-white/[0.025]" />

      <div className={!rainPossibleNext6h ? 'px-4 py-0' : 'px-5 py-4'}>
        {!rainPossibleNext6h ? (
          <>
            <p className="text-[9px] font-black uppercase tracking-widest text-white/40">
              Rain outlook
            </p>
            <p className="mt-1 text-[11px] leading-snug text-sky-50/90">
              No rain expected in the coming 6 hours — enjoy the beach!
            </p>
          </>
        ) : (
          <>
            <p className="text-[9px] font-black uppercase tracking-widest text-white/40">
              Rain outlook
            </p>
            <p className="mt-1 text-[10px] leading-snug text-slate-500">
              Live radar for the first hours, then the forecast — best read together.
            </p>

            <HybridRainHourlyStrip
              lat={latitude}
              lon={longitude}
              product={product}
              forecastRows={forecastRows}
              windDirDeg={windDirDeg}
              radarScrub={radarScrub}
              onRadarScrub={onRadarScrub}
              layout="drawer"
              className="mt-2"
            />

            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/35">
                Wind near you
              </p>
              <p className="mt-1 text-[11px] leading-snug text-white/80">
                Mostly from the{' '}
                <span className="font-semibold text-sky-200">{windFrom}</span> at about{' '}
                <span className="font-semibold text-sky-200">{windKmh} km/h</span> — a rough guide
                for how showers drift (arrows on the bars show if rain is building or easing).
              </p>
            </div>

            {nowcastUnavailable && (
              <p className="mt-3 text-[11px] leading-relaxed text-amber-100/85">
                No new radar update right now — please check back in a few minutes.
              </p>
            )}

            {statusLine && (
              <p className="mt-3 text-[11px] font-medium leading-snug text-amber-100/80">
                {statusLine}
              </p>
            )}

            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              className="mt-3 flex w-full items-center justify-between rounded-xl border border-sky-500/20 bg-sky-950/30 px-3 py-2 text-left transition hover:bg-sky-950/50"
            >
              <span className="text-[9px] font-black uppercase tracking-widest text-sky-300/90">
                Short-range steps at your pin
              </span>
              <span className="text-[10px] text-slate-500">{open ? '▲' : '▼'}</span>
            </button>

            {open && (
              <div className="mt-2 space-y-2">
                {loading && <p className="text-[10px] text-slate-500">Loading…</p>}
                {!loading && nowcastFrames.length === 0 && (
                  <p className="text-[10px] text-slate-500">No short-range loop in the feed yet.</p>
                )}
                {!loading && rows.length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10">
                    <table className="w-full text-left text-[10px] text-slate-200">
                      <thead>
                        <tr className="border-b border-white/10 text-slate-500">
                          <th className="px-2 py-1 font-semibold">Thailand time</th>
                          <th className="px-2 py-1 font-semibold">At your pin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.timeUnix} className="border-b border-white/5">
                            <td className="px-2 py-1 font-mono text-slate-300">
                              {fmtIctShort(r.timeUnix)}
                            </td>
                            <td
                              className={`px-2 py-1 ${
                                r.echo === 'precip' ? 'text-cyan-300' : 'text-slate-400'
                              }`}
                            >
                              {echoLabel(r.echo)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-[9px] leading-snug text-slate-500">
                  Same radar as the map. Coastal timing can differ from other apps — trust what you
                  see outside.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
