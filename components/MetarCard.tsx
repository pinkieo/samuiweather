'use client';

import React, { useEffect, useState } from 'react';
import type { MetarApiResponse, MetarStationKey } from '../app/api/metar/route';
import type { ParsedMetar, ParsedTaf, ParsedTafPeriod } from '../lib/metar';
import DataFreshnessBadge from './DataFreshnessBadge';
import type { SourceFreshness } from '../lib/data-freshness';

const STATIONS: { icao: MetarStationKey; iata: string; short: string }[] = [
  { icao: 'VTSM', iata: 'USM', short: 'Samui' },
  { icao: 'VTSG', iata: 'KBV', short: 'Krabi' },
  { icao: 'VTSP', iata: 'HKT', short: 'Phuket' },
];

const STATION_TITLE: Record<MetarStationKey, string> = {
  VTSM: 'Samui International Airport Sensors',
  VTSG: 'Krabi International Airport Sensors',
  VTSP: 'Phuket International Airport Sensors',
};

// ── Flight category badge ──────────────────────────────────────────────────────

const fltCatCfg = {
  green:   { label: 'VFR',  bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  yellow:  { label: 'MVFR', bg: 'bg-amber-500/15',   border: 'border-amber-500/30',   text: 'text-amber-300',   dot: 'bg-amber-400'   },
  red:     { label: 'IFR',  bg: 'bg-red-500/15',     border: 'border-red-500/30',     text: 'text-red-300',     dot: 'bg-red-400'     },
  darkred: { label: 'LIFR', bg: 'bg-rose-900/30',    border: 'border-rose-500/30',    text: 'text-rose-300',    dot: 'bg-rose-600'    },
};

function FltCatBadge({ color, label }: { color: keyof typeof fltCatCfg; label?: string }) {
  const cfg = fltCatCfg[color];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${cfg.dot}`} />
      {label ?? cfg.label}
    </span>
  );
}

// ── Raw METAR display ──────────────────────────────────────────────────────────

function RawMetarLine({ raw }: { raw: string }) {
  const tokens = raw.split(' ').map((token, i) => {
    let color = 'text-slate-400';
    if (i === 0) color = 'text-slate-600';
    else if (/^[A-Z]{4}$/.test(token)) color = 'text-cyan-300 font-bold';
    else if (/^\d{6}Z$/.test(token)) color = 'text-purple-300';
    else if (/^\d{5}(G\d{2})?KT$/.test(token)) color = 'text-blue-300';
    else if (/^\d{4}$/.test(token) || token === '9999') color = 'text-emerald-300';
    else if (/^(FEW|SCT|BKN|OVC|SKC|CLR)\d*$/.test(token)) color = 'text-amber-300';
    else if (/^\d{2}\/\d{2}$/.test(token)) color = 'text-orange-300';
    else if (/^Q\d{4}$/.test(token)) color = 'text-rose-300';
    else if (token === 'NOSIG') color = 'text-emerald-400 font-bold';
    return <span key={i} className={color}>{token} </span>;
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-white/8 bg-slate-950/50 px-3 py-2">
      <code className="whitespace-nowrap font-mono text-[10px] leading-relaxed">{tokens}</code>
    </div>
  );
}

function DataRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-4 shrink-0 text-center text-xs">{icon}</span>
      <span className="w-16 shrink-0 text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <span className="text-[11px] text-slate-200">{value}</span>
    </div>
  );
}

function TafRow({ period }: { period: ParsedTafPeriod }) {
  const hasStorm = period.wx?.toLowerCase().includes('thunder');
  const hasRain  = period.wx?.toLowerCase().includes('rain') || period.wx?.toLowerCase().includes('shower');
  const borderColor = hasStorm ? 'border-rose-500/30' : hasRain ? 'border-amber-500/20' : 'border-white/8';

  return (
    <div className={`rounded-xl border ${borderColor} bg-white/3 px-3 py-2`}>
      <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-slate-500">
        {period.change
          ? <span className="text-amber-400">{period.change} · </span>
          : null}
        {period.label}
      </p>
      <p className="text-[11px] leading-relaxed text-slate-300">{period.sammiLine}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {period.clouds.map((c, i) => (
          <span key={i} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-400">
            {c.cover}{c.base ? ` ${(c.base / 100).toFixed(0)}×100ft` : ''}
          </span>
        ))}
        {period.wx && (
          <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-300">
            {period.wx}
          </span>
        )}
      </div>
    </div>
  );
}

function MetarSection({
  metar,
  freshness,
  title,
}: {
  metar: ParsedMetar;
  freshness: SourceFreshness | null;
  title: string;
}) {
  const obsDate = new Date(metar.obsTime * 1000).toLocaleString('en-US', {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Bangkok', hour12: false,
  });

  const windDir  = metar.wdir === 0 ? 'calm' : `${metar.wdir}°`;
  const windStr  = metar.wspd
    ? `${windDir} · ${metar.wspd} kts${metar.wgst ? ` (gusts ${metar.wgst} kts)` : ''}`
    : 'calm';
  const visStr   = metar.visib === '6+' || metar.visib === '9999'
    ? '10km+ (unlimited)'
    : `${metar.visib}km`;
  const cloudStr = metar.clouds.length
    ? metar.clouds.map(c => `${c.label}${c.base ? ` @ ${c.base.toLocaleString()}ft` : ''}`).join(' · ')
    : 'Sky clear';
  const tempStr  = metar.temp != null ? `${metar.temp}°C / dewpoint ${metar.dewp}°C` : '—';

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
            {title}
          </p>
          <p className="mt-0.5 text-[9px] text-slate-600">Observed {obsDate} ICT</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <FltCatBadge color={metar.fltCatColor} label={metar.fltCat} />
          {freshness && (
            <DataFreshnessBadge
              label="Airport sync"
              icon="✈️"
              freshness={freshness}
              showSyncTime={false}
            />
          )}
        </div>
      </div>

      {freshness?.isStale && freshness.sammiNote && (
        <div className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2">
          <p className="text-[10px] italic text-amber-200">
            💬 {freshness.sammiNote}
          </p>
        </div>
      )}

      <div className="mb-3">
        <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-600">
          Raw Airport Sensor Feed <span className="text-slate-700 normal-case font-normal">(Sammi reads this so you don&apos;t have to)</span>
        </p>
        <RawMetarLine raw={metar.raw} />
      </div>

      <div className="mb-3 space-y-1.5 rounded-xl border border-white/8 bg-white/3 px-3 py-3">
        <DataRow icon="💨" label="Wind"    value={windStr} />
        <DataRow icon="👁️" label="Vis"     value={visStr} />
        <DataRow icon="☁️" label="Clouds"  value={cloudStr} />
        <DataRow icon="🌡️" label="Temp"    value={tempStr} />
        {metar.qnh && <DataRow icon="📊" label="QNH" value={`${metar.qnh} hPa`} />}
        {metar.wxString && <DataRow icon="⚡" label="Wx" value={metar.wxString} />}
      </div>

      <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3">
        <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">
          ✨ Sammi Reads the METAR
        </p>
        <p className="text-[11px] leading-relaxed text-slate-200">☁️ {metar.sammiSky}</p>
        <p className="text-[11px] leading-relaxed text-slate-200">💨 {metar.sammiWind}</p>
        <p className="text-[11px] leading-relaxed text-slate-200">👁️ {metar.sammiVisMood}</p>
        <div className="mt-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
          <p className="text-[11px] font-semibold italic text-cyan-200">{metar.sammiVerdict}</p>
        </div>
      </div>
    </div>
  );
}

function TafSection({ taf }: { taf: ParsedTaf }) {
  const validStr = taf.validTo.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Bangkok', hour12: false,
  });

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">
          ✈️ 24-Hour Outlook · Airstrip Forecast
        </p>
        <p className="text-[9px] text-slate-600">Valid until {validStr} ICT</p>
      </div>

      <div className="mb-3">
        <div className="overflow-x-auto rounded-xl border border-white/8 bg-slate-950/50 px-3 py-2">
          <code className="whitespace-nowrap font-mono text-[10px] text-slate-500">{taf.raw}</code>
        </div>
      </div>

      <div className="space-y-2">
        {taf.periods.map((p, i) => <TafRow key={i} period={p} />)}
      </div>
    </div>
  );
}

export default function MetarCard({ defaultIcao }: { defaultIcao: MetarStationKey }) {
  const [data, setData] = useState<MetarApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MetarStationKey>(defaultIcao);

  useEffect(() => {
    setSelected(defaultIcao);
  }, [defaultIcao]);

  useEffect(() => {
    fetch('/api/metar', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: MetarApiResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/5 px-4 py-5 text-xs text-slate-400">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
        Fetching airport METAR / TAF (USM · KBV · HKT)…
      </div>
    );
  }

  if (!data?.stations) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[11px] text-amber-300">
        METAR unavailable — aviationweather.gov not responding.
        {data?.error ? ` (${data.error})` : ''}
      </div>
    );
  }

  const bundle = data.stations[selected];
  const hasAny = STATIONS.some(
    s => data.stations[s.icao].metar || data.stations[s.icao].taf,
  );

  if (!hasAny) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[11px] text-amber-300">
        No METAR/TAF data in response — try again shortly.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {STATIONS.map(
          ({ icao, iata, short }) => (
            <button
              key={icao}
              type="button"
              onClick={() => setSelected(icao)}
              className={[
                'rounded-lg border px-2.5 py-1 text-[9px] font-black uppercase tracking-wide transition',
                selected === icao
                  ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
                  : 'border-white/10 bg-white/5 text-slate-500 hover:border-white/20 hover:text-slate-300',
              ].join(' ')}
            >
              {iata} · {short}
            </button>
          ),
        )}
      </div>

      {!bundle.metar && !bundle.taf && (
        <div className="mb-3 rounded-xl border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-200">
          No observation for this station yet — pick another airport above.
        </div>
      )}

      {bundle.metar && (
        <MetarSection
          metar={bundle.metar}
          freshness={bundle.freshness}
          title={STATION_TITLE[selected]}
        />
      )}
      {bundle.taf && <TafSection taf={bundle.taf} />}
    </div>
  );
}
