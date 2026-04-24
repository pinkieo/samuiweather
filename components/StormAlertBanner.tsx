'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { ConflictStatusResponse } from '@/app/api/conflict-status/route';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // Re-check every 5 minutes

export default function StormAlertBanner({
  region = 'samui',
  onActiveChange,
}: {
  region?: 'samui' | 'krabi';
  /** True while the alert strip is visible (not dismissed) — parent can offset UI below it. */
  onActiveChange?: (active: boolean) => void;
}) {
  const [data, setData]       = useState<ConflictStatusResponse | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dismissedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = async () => {
    try {
      const q = region === 'krabi' ? '?region=krabi' : '';
      const res = await fetch(`/api/conflict-status${q}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json: ConflictStatusResponse = await res.json();
      setData(json);

      // If alert clears, let the slide-up animation run before hiding
      if (!json.isAlert) {
        setVisible(false);
      } else if (!dismissedRef.current) {
        setVisible(true);
      }
    } catch {
      // silently ignore — banner absence is better than a crash
    }
  };

  useEffect(() => {
    fetchStatus();
    timerRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region]);

  // Re-show banner if a new alert comes in after dismissal
  useEffect(() => {
    if (data?.isAlert) {
      setDismissed(false);
      dismissedRef.current = false;
    }
  }, [data?.scenario, data?.echoTier]);

  const bannerActive = Boolean(data?.isAlert && visible && !dismissed);
  useEffect(() => {
    onActiveChange?.(bannerActive);
  }, [bannerActive, onActiveChange]);

  const isStorm = data?.scenario === 'storm_incoming';
  const isAllAlarm = data?.scenario === 'all_alarm';
  const isUpstream = data?.scenario === 'upstream_metar_rain';
  const isRainAlert = data?.scenario === 'rain_alert';
  if (!data?.isAlert) return null;

  const echoTier = data?.echoTier;
  const echoTierLabel =
    echoTier != null
      ? ({ light: 'Light', medium: 'Medium', heavy: 'Heavy', storm: 'Storm' } as const)[echoTier]
      : null;
  const echoZone =
    data?.echoSamplePerimeterKm != null && data?.echoSampleRadiusKm != null
      ? `~${data.echoSamplePerimeterKm} km loop at pin (r ≈ ${data.echoSampleRadiusKm.toFixed(1)} km)`
      : null;

  const label = isStorm
    ? region === 'krabi' && echoTierLabel
      ? `Storm alert · Doppler: ${echoTierLabel} at pin`
      : 'Storm cell detected · Mainland Radar'
    : isAllAlarm
    ? 'All sources confirm severe weather'
    : isUpstream
    ? 'METAR upstream signal · Krabi + Phuket'
    : isRainAlert
    ? region === 'krabi' && echoTierLabel
      ? `Doppler: ${echoTierLabel} — local rain signal`
      : 'Rain on mainland radar'
    : 'Weather alert';

  const subLabel = isStorm
    ? region === 'krabi'
      ? (echoZone
        ? `Significant cell — ${echoZone} · SPIRE + METAR cross-check`
        : 'Significant cell on the mainland sweep — track for Krabi / Andaman coast')
      : 'Significant precipitation cell tracking towards Koh Samui'
    : isUpstream
    ? 'METAR at Phuket or Krabi reports precipitation while radar and satellites still look dry'
    : isRainAlert
    ? region === 'krabi' && echoZone
      ? `${echoZone} — models may still look dry; check strip + METAR`
      : 'Mainland radar shows precipitation — SPIRE and METAR still cross-checked'
    : 'Orbital · Mainland Radar · Airport sensors all in agreement';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={[
        // Slide-down animation via translate + opacity
        'fixed left-0 right-0 top-0 z-[9999]',
        'transform transition-all duration-500 ease-out',
        visible && !dismissed
          ? 'translate-y-0 opacity-100'
          : '-translate-y-full opacity-0 pointer-events-none',
      ].join(' ')}
    >
      {/* Outer strip — deep amber / caution */}
      <div className="relative flex items-stretch bg-amber-500 shadow-[0_4px_32px_rgba(0,0,0,0.6)]">

        {/* Left accent bar */}
        <div className="w-1.5 shrink-0 bg-black/30" />

        {/* Main content */}
        <div className="flex flex-1 flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">

          {/* Icon + headline */}
          <div className="flex items-center gap-2.5">
            {/* Blinking warning icon */}
            <span
              className="text-xl leading-none"
              style={{ animation: 'sammi-blink 1s step-start infinite' }}
              aria-hidden="true"
            >
              ⚠️
            </span>
            <span className="text-sm font-black uppercase tracking-wider text-black">
              SAMMI STORM ALERT
            </span>
            <span className="hidden text-black/60 sm:inline">·</span>
            <span className="hidden text-xs font-semibold text-black/70 sm:inline">
              {label}
            </span>
          </div>

          {/* Sub-label (mobile) */}
          <span className="text-xs font-semibold text-black/70 sm:hidden">{label}</span>

          {/* Description */}
          <span className="text-xs text-black/60 sm:text-xs">{subLabel}</span>

          {/* Mode badge */}
          <span className="shrink-0 rounded border border-black/20 bg-black/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-black">
            Mode: Command Center
          </span>
        </div>

        {/* Right-side actions */}
        <div className="flex shrink-0 items-center gap-1 pr-3">
          {/* Scroll to dashboard */}
          <a
            href="#live-samui-intel"
            className="rounded-lg bg-black/20 px-3 py-1.5 text-[11px] font-bold text-black hover:bg-black/30 transition-colors"
            onClick={() => {
              const el = document.getElementById('live-samui-intel');
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            View Intel ↓
          </a>
          {/* Dismiss */}
          <button
            aria-label="Dismiss alert"
            onClick={() => {
              setVisible(false);
              setDismissed(true);
              dismissedRef.current = true;
            }}
            className="ml-1 rounded-lg bg-black/10 px-2 py-1.5 text-base font-bold text-black/50 hover:bg-black/25 hover:text-black transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* CSS keyframe for blink */}
      <style>{`
        @keyframes sammi-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
