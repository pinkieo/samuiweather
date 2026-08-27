'use client';

import React, { useEffect, useState } from 'react';
import type { IslandPoi } from '../lib/island-pois';
import { formatTempC, formatWindMs, type SamuiWeatherForecastRow } from '../lib/spire';

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export default function PoiIntelligenceCard({
  poi,
  onClose,
  className = '',
}: {
  poi: IslandPoi;
  onClose: () => void;
  /** Positioning is applied by the parent (e.g. beside the weather drawer) */
  className?: string;
}) {
  const [spire, setSpire] = useState<SamuiWeatherForecastRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const q = `lat=${poi.lat}&lon=${poi.lon}`;

    fetch(`/api/weather/point?${q}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((sp) => {
        if (cancelled) return;
        setSpire(sp?.now ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setSpire(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [poi.lat, poi.lon]);

  const spDir =
    spire != null ? DIRS[Math.round(spire.windDir / 22.5) % 16] : '—';

  return (
    <div
      className={`pointer-events-auto max-h-[min(70vh,520px)] w-full overflow-y-auto rounded-2xl border border-cyan-500/30 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md ${className}`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-cyan-400/90">
            {poi.kind === 'beach_club' ? '🏖 Beach club' : '🍽 Restaurant'}
          </p>
          <h3 className="text-base font-bold text-white">{poi.name}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-[10px] text-slate-400 transition hover:border-white/30 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3 text-[11px] leading-relaxed text-white/85">
        <section>
          <p className="mb-1 text-[8px] font-black uppercase tracking-wider text-white/35">
            Atmosphere
          </p>
          <p>{poi.atmosphere}</p>
        </section>

        <section>
          <p className="mb-1 text-[8px] font-black uppercase tracking-wider text-white/35">
            Parking &amp; access
          </p>
          <p>{poi.parkingAdvice}</p>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <p className="mb-2 text-[8px] font-black uppercase tracking-wider text-cyan-300/80">
            Live weather · this pin
          </p>
          {loading && <p className="text-[10px] text-slate-500">Loading…</p>}
          {!loading && (
            <div>
              <p className="text-[8px] font-bold uppercase tracking-wide text-white/35">
                Lead forecast
              </p>
              {spire ? (
                <p>
                  {formatTempC(spire.temp)}°C ·{' '}
                  {spire.precipRate > 0
                    ? `${spire.precipRate.toFixed(1)} mm/h`
                    : 'dry'}{' '}
                  · {spDir} {formatWindMs(spire.windSpeed)} m/s
                </p>
              ) : (
                <p className="text-slate-500">No data at this pin</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
