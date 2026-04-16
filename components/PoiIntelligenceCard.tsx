'use client';

import React, { useEffect, useState } from 'react';
import type { IslandPoi } from '../lib/island-pois';
import type { SamuiWeatherForecastRow } from '../lib/spire';

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

interface ModelCrossSnap {
  tempC: number | null;
  windSpeedMs: number | null;
  windDirDeg: number | null;
  precipMm: number | null;
}

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
  const [modelCross, setModelCross] = useState<ModelCrossSnap | null>(null);
  const [modelCrossOff, setModelCrossOff] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const q = `lat=${poi.lat}&lon=${poi.lon}`;

    Promise.all([
      fetch(`/api/weather/point?${q}`).then(r => (r.ok ? r.json() : null)),
      fetch(`/api/meteoblue/point?${q}`).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([sp, mb]) => {
        if (cancelled) return;
        setSpire(sp?.now ?? null);
        if (mb?.ok && mb?.snapshot) {
          setModelCross(mb.snapshot as ModelCrossSnap);
          setModelCrossOff(false);
        } else {
          setModelCross(null);
          setModelCrossOff(mb?.enabled === false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSpire(null);
          setModelCross(null);
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
  const mbDir =
    modelCross?.windDirDeg != null
      ? DIRS[Math.round(modelCross.windDirDeg / 22.5) % 16]
      : '—';

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
          {loading && (
            <p className="text-[10px] text-slate-500">Fetching Spire + meteoblue…</p>
          )}
          {!loading && (
            <div className="space-y-2">
              <div>
                <p className="text-[8px] font-bold uppercase tracking-wide text-white/35">
                  Spire (lead)
                </p>
                {spire ? (
                  <p>
                    {Math.round(spire.temp)}°C ·{' '}
                    {spire.precipRate > 0
                      ? `${spire.precipRate.toFixed(1)} mm/h`
                      : 'dry'}{' '}
                    · {spDir} {spire.windSpeed.toFixed(0)} kts
                  </p>
                ) : (
                  <p className="text-slate-500">No Spire data</p>
                )}
              </div>
              <div>
                <p className="text-[8px] font-bold uppercase tracking-wide text-white/35">
                  meteoblue (cross-check)
                </p>
                {modelCrossOff && (
                  <p className="text-[10px] text-slate-500">
                    Add <code className="text-cyan-400/90">METEOBLUE_API_KEY</code> for
                    model cross-check.
                  </p>
                )}
                {!modelCrossOff && modelCross && (
                  <p>
                    {modelCross.tempC != null ? `${modelCross.tempC}°C` : '—'} ·{' '}
                    {modelCross.precipMm != null && modelCross.precipMm > 0
                      ? `${modelCross.precipMm} mm`
                      : 'dry'}{' '}
                    ·{' '}
                    {modelCross.windSpeedMs != null
                      ? `${mbDir} ${(modelCross.windSpeedMs * 1.94384).toFixed(0)} kts`
                      : '—'}
                  </p>
                )}
                {!modelCrossOff && !modelCross && !loading && (
                  <p className="text-slate-500">meteoblue unavailable</p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
