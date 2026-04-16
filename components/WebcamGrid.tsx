'use client';

import React, { useEffect, useState } from 'react';
import type { WebcamsResponse, WebcamEntry } from '../app/api/webcams/route';

// ── Region config ──────────────────────────────────────────────────────────────

const regionCfg: Record<string, { label: string; color: string; dot: string; icon: string }> = {
  east:    { label: 'East Coast',  color: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/25',    dot: 'bg-cyan-400',    icon: '🌅' },
  west:    { label: 'West Coast',  color: 'text-orange-300 bg-orange-500/15 border-orange-500/25', dot: 'bg-orange-400', icon: '🌇' },
  north:   { label: 'North Coast', color: 'text-blue-300 bg-blue-500/15 border-blue-500/25',    dot: 'bg-blue-400',    icon: '⛵' },
  south:   { label: 'South Coast', color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/25', dot: 'bg-emerald-400', icon: '🤿' },
  central: { label: 'Central',     color: 'text-purple-300 bg-purple-500/15 border-purple-500/25', dot: 'bg-purple-400', icon: '✈️' },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function RegionBadge({ region }: { region: string }) {
  const cfg = regionCfg[region] ?? regionCfg.central;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${cfg.color}`}>
      <span className={`h-1 w-1 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function WatchButton({ url, label = 'Watch Live' }: { url: string; label?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-white/20 active:scale-95"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
      {label}
    </a>
  );
}

// ── Featured cam card ──────────────────────────────────────────────────────────

function FeaturedCam({
  cam,
  postTitle,
  postScore,
}: {
  cam: WebcamEntry;
  postTitle: string | null;
  postScore: number | null;
}) {
  const cfg = regionCfg[cam.region] ?? regionCfg.central;
  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-white/15 bg-white/5 backdrop-blur-sm">
      {/* Header band */}
      <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{cfg.icon}</span>
          <span className="text-[9px] font-black uppercase tracking-widest text-white/50">
            📹 Sammi's Featured Cam
          </span>
        </div>
        {postScore != null && (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
            {postScore}/10 💅
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-white">{cam.name}</p>
            <div className="mt-1">
              <RegionBadge region={cam.region} />
            </div>
          </div>
          <WatchButton url={cam.url} label="Live →" />
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
          {cam.description}
        </p>

        {postTitle && (
          <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
              Last Sammi post
            </p>
            <p className="mt-0.5 line-clamp-2 text-[11px] italic text-slate-300">
              "{postTitle}"
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Regular cam card ───────────────────────────────────────────────────────────

function CamCard({ cam }: { cam: WebcamEntry }) {
  const cfg = regionCfg[cam.region] ?? regionCfg.central;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/5 p-3 transition hover:border-white/15 hover:bg-white/8">
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{cfg.icon}</span>
        <RegionBadge region={cam.region} />
      </div>
      <p className="text-[11px] font-bold leading-tight text-white">{cam.name}</p>
      <p className="line-clamp-2 flex-1 text-[10px] leading-relaxed text-slate-500">
        {cam.description}
      </p>
      <WatchButton url={cam.url} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function WebcamGrid() {
  const [data, setData] = useState<WebcamsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState<string>('all');

  useEffect(() => {
    fetch('/api/webcams')
      .then(r => r.json())
      .then((d: WebcamsResponse) => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/5 px-4 py-5 text-xs text-slate-400">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
        Loading island eyes…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[11px] text-amber-300">
        Webcams unavailable — check Supabase connection.
      </div>
    );
  }

  const { cams, featured } = data;

  // Filter out the featured cam from the grid to avoid duplication
  const gridCams = cams.filter(c => c.url !== featured.cam?.url);

  // Available regions for filter pills
  const regions = ['all', ...Array.from(new Set(cams.map(c => c.region))).sort()];

  const filtered = regionFilter === 'all'
    ? gridCams
    : gridCams.filter(c => c.region === regionFilter);

  return (
    <div>
      {/* Featured cam */}
      {featured.cam && (
        <FeaturedCam
          cam={featured.cam}
          postTitle={featured.postTitle}
          postScore={featured.postScore}
        />
      )}

      {/* Region filter pills */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {regions.map(r => {
          const cfg = r === 'all' ? null : (regionCfg[r] ?? regionCfg.central);
          return (
            <button
              key={r}
              onClick={() => setRegionFilter(r)}
              className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider transition ${
                regionFilter === r
                  ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-300'
                  : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-white'
              }`}
            >
              {cfg ? `${cfg.icon} ${cfg.label}` : '🗺️ All'}
            </button>
          );
        })}
      </div>

      {/* Cam grid */}
      {filtered.length === 0 ? (
        <p className="text-center text-[11px] text-slate-500 py-4">No cams in this region.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filtered.map(cam => (
            <CamCard key={cam.id} cam={cam} />
          ))}
        </div>
      )}

      {/* Footer note */}
      <p className="mt-3 text-center text-[9px] text-slate-600">
        {cams.length} live feeds · updated by Sammi's satellites
      </p>
    </div>
  );
}
