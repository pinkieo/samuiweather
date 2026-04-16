'use client';

import React, { useEffect, useState } from 'react';

// Arrival target — update this when the hardware ships
const ARRIVAL_DATE = new Date('2026-04-26T00:00:00+07:00'); // Bangkok time

function useDaysUntil(target: Date) {
  const [days, setDays] = useState<number | null>(null);
  const [hours, setHours] = useState<number | null>(null);

  useEffect(() => {
    function tick() {
      const diff = target.getTime() - Date.now();
      if (diff <= 0) { setDays(0); setHours(0); return; }
      setDays(Math.floor(diff / (1000 * 60 * 60 * 24)));
      setHours(Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [target]);

  return { days, hours };
}

const SENSORS = [
  { icon: '🌡️', name: 'Hyper-local temperature', status: 'OFFLINE' },
  { icon: '💧', name: 'Exact rainfall mm/h',      status: 'OFFLINE' },
  { icon: '💨', name: 'Ground-level wind',         status: 'OFFLINE' },
  { icon: '☀️', name: 'Solar UV & lux',            status: 'OFFLINE' },
  { icon: '💦', name: 'Soil moisture',             status: 'OFFLINE' },
];

export default function EcowittPlaceholder() {
  const { days, hours } = useDaysUntil(ARRIVAL_DATE);
  const arrived = days === 0 && hours === 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-dashed border-white/15 bg-white/3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm">📍</span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
              Local Precision
            </p>
            <p className="text-[9px] text-slate-500">Baan Ton Kluay · Koh Samui</p>
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${
          arrived
            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        }`}>
          {arrived ? '✓ ONLINE' : '⚓ ARRIVING VIA SEA'}
        </span>
      </div>

      {/* Body */}
      <div className="p-4">
        {/* Countdown */}
        {!arrived && days !== null && (
          <div className="mb-3 flex items-center justify-center gap-3 rounded-xl border border-white/8 bg-slate-950/40 py-3">
            <div className="text-center">
              <p className="text-2xl font-black tabular-nums text-white">{days}</p>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">days</p>
            </div>
            <span className="text-slate-600 text-lg">:</span>
            <div className="text-center">
              <p className="text-2xl font-black tabular-nums text-white">{hours ?? '—'}</p>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">hours</p>
            </div>
            <div className="ml-2 text-left">
              <p className="text-[9px] font-bold text-slate-400">Ecowitt</p>
              <p className="text-[9px] text-slate-600">Hyper-Local Array</p>
              <p className="text-[9px] text-slate-600">T-minus {days}d {hours}h</p>
            </div>
          </div>
        )}

        {/* Sensor list */}
        <div className="mb-3 space-y-1.5">
          {SENSORS.map(s => (
            <div key={s.name} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/3 px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs">{s.icon}</span>
                <span className="text-[10px] text-slate-400">{s.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
                <span className="text-[9px] font-bold text-slate-600">{s.status}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Sammi quote */}
        <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-1">
            ✨ Sammi says
          </p>
          <p className="text-[11px] italic leading-relaxed text-slate-300">
            {arrived
              ? '"My Baan Ton Kluay sensors are online. I now have hyper-local ground truth to match my orbital and radar data. We are officially untouchable."'
              : '"If my local sensors were already here, I\'d give you the exact rainfall count at ground level — down to the drop. They\'re en route by sea. For now, the airport radar and my satellites are holding the fort. Worth the wait, darling."'
            }
          </p>
        </div>

        {/* Location note */}
        <p className="mt-2.5 text-center text-[9px] text-slate-600">
          Ecowitt HP2550 Pro · 5-in-1 array · Solar powered · Samui WiFi mesh
        </p>
      </div>
    </div>
  );
}
