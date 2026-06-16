'use client';

import React from 'react';

export type RadarOverlayProps = {
  /** Full URL to one RainViewer tile image (pin-centered snapshot). */
  frameUrl: string;
  /** Badge above bottom-left caption (e.g. “Radar snapshot”). */
  label?: string;
  /** Optional clear control (pointer-events auto). */
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
};

/**
 * Semi-transparent full-bleed radar tile over the map (Buienradar-style still).
 */
export default function RadarOverlay({
  frameUrl,
  label = 'Live radar',
  onDismiss,
  dismissLabel = 'Live map',
  className,
}: RadarOverlayProps) {
  return (
    <div
      className={[
        'pointer-events-none absolute inset-0 z-[15] flex flex-col',
        className ?? '',
      ].join(' ')}
      role="presentation"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-none border border-cyan-400/35 shadow-[inset_0_0_32px_rgba(15,23,42,0.25)] sm:rounded-lg">
        <img
          key={frameUrl}
          src={frameUrl}
          alt=""
          width={512}
          height={512}
          decoding="async"
          className="h-full w-full object-cover opacity-70"
        />
        <div className="pointer-events-auto absolute right-2 top-2 flex items-center gap-1.5 sm:right-3 sm:top-3">
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md border border-white/25 bg-slate-950/90 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-cyan-200 shadow-lg backdrop-blur-sm transition hover:bg-slate-900/95"
            >
              {dismissLabel}
            </button>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/20 bg-slate-950/85 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-cyan-100 shadow-md backdrop-blur-sm">
          {label}
        </div>
      </div>
    </div>
  );
}
