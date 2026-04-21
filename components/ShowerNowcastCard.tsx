'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { RadarEchoSample } from '../lib/rainviewer-tile-sample';
import {
  buildShowerNowcastSchedule,
  comparePastEchoAtPin,
  compass16FromDeg,
  type ShowerNowcastRow,
} from '../lib/shower-nowcast-schedule';

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
  if (e === 'precip') return 'Rain signal';
  if (e === 'none') return 'No echo';
  return '—';
}

export interface ShowerNowcastCardProps {
  latitude: number;
  longitude: number;
  /** Spire surface wind (m/s) — rough guide for shower motion vs radar extrapolation. */
  windSpeedMs: number;
  windDirDeg: number;
  nowcastFrames: { path: string; time: number }[];
  pastFrames: { path: string; time: number }[];
  radarReady: boolean;
}

/**
 * Buienradar-style **short extrapolation** using RainViewer `nowcast` frames at the dashboard pin,
 * plus a SPIRE wind hint (same policy as the rest of the app: no third-party forecast API).
 */
export default function ShowerNowcastCard({
  latitude,
  longitude,
  windSpeedMs,
  windDirDeg,
  nowcastFrames,
  pastFrames,
  radarReady,
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
    if (!open || !radarReady) return;
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
  }, [open, radarReady, latitude, longitude, feedFingerprint]);

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

  const headline = (() => {
    if (!radarReady || nowcastFrames.length === 0) {
      return 'RainViewer is not publishing a short forecast loop right now — check back in a few minutes.';
    }
    if (loading) return 'Sampling radar at this pin…';
    if (rows.length === 0) return 'Could not sample the nowcast tiles.';
    if (pastDelta === 'arriving') {
      return `Echo is building toward this spot on recent scans — showers may be moving in.`;
    }
    if (pastDelta === 'leaving') {
      return `Echo is fading here on recent scans — rain may be easing.`;
    }
    if (firstRainUnix != null) {
      return `Next radar rain signal at this pin around ${fmtIctShort(firstRainUnix)} ICT (extrapolated).`;
    }
    if (firstClearAfterRainUnix != null) {
      return `A clearer window may appear around ${fmtIctShort(firstClearAfterRainUnix)} ICT on this model run.`;
    }
    return 'No rain signal at this pin in the next nowcast steps — still watch the live overlay.';
  })();

  return (
    <div
      className="
        overflow-hidden rounded-3xl border border-sky-500/25
        bg-slate-900
        shadow-[0_4px_32px_rgba(0,0,0,0.45)]
      "
    >
      <div className="pointer-events-none absolute -left-10 top-0 h-full w-24 rotate-12 bg-white/[0.025]" />

      <div className="px-5 py-4">
        <p className="text-[9px] font-black uppercase tracking-widest text-white/40">
          Shower radar (short forecast)
        </p>
        <p className="mt-1 text-[10px] leading-snug text-sky-50/85">
          Like Buienradar: RainViewer extrapolates the mainland radar. SPIRE wind is a rough guide for
          how convection often moves — not a warning.
        </p>

        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-white/35">
            Model wind (SPIRE, surface)
          </p>
          <p className="mt-1 text-[11px] leading-snug text-white/80">
            From <span className="font-semibold text-sky-200">{windFrom}</span> at ~{windKmh} km/h
            (wind direction = where the wind comes from).
          </p>
        </div>

        <p className="mt-3 text-[11px] font-semibold leading-snug text-amber-100/80">{headline}</p>

        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="mt-3 flex w-full items-center justify-between rounded-xl border border-sky-500/20 bg-sky-950/30 px-3 py-2 text-left transition hover:bg-sky-950/50"
        >
          <span className="text-[9px] font-black uppercase tracking-widest text-sky-300/90">
            Timeline at this pin (nowcast)
          </span>
          <span className="text-[10px] text-slate-500">{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div className="mt-2 space-y-2">
            {loading && (
              <p className="text-[10px] text-slate-500">Loading tile samples…</p>
            )}
            {!loading && nowcastFrames.length === 0 && (
              <p className="text-[10px] text-slate-500">No nowcast frames in the feed.</p>
            )}
            {!loading && rows.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10">
                <table className="w-full text-left text-[10px] text-slate-200">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-500">
                      <th className="px-2 py-1 font-semibold">ICT</th>
                      <th className="px-2 py-1 font-semibold">Radar at pin</th>
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
              Uses the same Surat Thani composite as the map overlay. Coastal timing can differ from
              a phone app — always verify with your eyes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
