'use client';

import React, { useEffect, useState } from 'react';
import type { SammiResponse } from '../app/api/reddit/route';

// ─── Mood config ─────────────────────────────────────────────────────────────

const moodConfig = {
  positive: {
    border: 'border-emerald-500/30',
    bg: 'from-slate-900/80 via-emerald-950/40 to-teal-950/50',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    bubble: 'bg-emerald-900/40 border-emerald-500/20',
    dot: 'bg-emerald-400',
  },
  cautious: {
    border: 'border-amber-500/30',
    bg: 'from-slate-900/80 via-amber-950/40 to-yellow-950/50',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    bubble: 'bg-amber-900/30 border-amber-500/20',
    dot: 'bg-amber-400',
  },
  alert: {
    border: 'border-rose-500/35',
    bg: 'from-slate-900/80 via-rose-950/40 to-red-950/50',
    badge: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    bubble: 'bg-rose-900/30 border-rose-500/20',
    dot: 'bg-rose-400',
  },
  neutral: {
    border: 'border-white/10',
    bg: 'from-slate-900/80 to-slate-800/80',
    badge: 'bg-white/10 text-slate-300 border-white/15',
    bubble: 'bg-white/5 border-white/10',
    dot: 'bg-slate-400',
  },
};

// ─── Sammi Avatar ─────────────────────────────────────────────────────────────
// Replace public/sammi.jpg with a real photo to swap the avatar.

function SammiAvatar({ mood }: { mood: SammiResponse['sammiMood'] }) {
  const ringColor =
    mood === 'positive' ? 'ring-emerald-400/60' :
    mood === 'cautious' ? 'ring-amber-400/60' :
    mood === 'alert'    ? 'ring-rose-400/60' :
    'ring-white/20';

  return (
    <div className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-full ring-2 ${ringColor} shadow-lg`}>
      {/* Try real photo first, fallback to illustrated avatar */}
      <img
        src="/sammi.jpg"
        alt="Sammi"
        className="h-full w-full object-cover"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
      {/* Fallback illustrated avatar (shown when no photo) */}
      <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-br from-rose-400 via-pink-500 to-purple-600">
        <svg viewBox="0 0 64 80" className="w-full" fill="none">
          {/* Simple illustrated woman silhouette */}
          <ellipse cx="32" cy="24" rx="12" ry="14" fill="#fde3c8" />
          <path d="M20 24 Q20 14 32 12 Q44 14 44 24" fill="#3b1a08" />
          <path d="M16 28 Q18 22 32 22 Q46 22 48 28 L50 80 H14 Z" fill="#e879a0" opacity="0.85" />
          <ellipse cx="32" cy="38" rx="14" ry="8" fill="#fde3c8" />
        </svg>
      </div>
    </div>
  );
}

// ─── Time formatting ──────────────────────────────────────────────────────────

function timeAgo(utcSeconds: number): string {
  const diffMs = Date.now() - utcSeconds * 1000;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SammiCard() {
  const [data, setData] = useState<SammiResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    fetch('/api/reddit', { signal: controller.signal })
      .then(async (res) => {
        clearTimeout(timer);
        const json = await res.json() as SammiResponse & { error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        setData(json);
        setStatus('ok');
      })
      .catch(() => {
        clearTimeout(timer);
        setStatus('error');
      });

    return () => { clearTimeout(timer); controller.abort(); };
  }, []);

  if (status === 'error') return null;

  const mood = data?.sammiMood ?? 'neutral';
  const cfg = moodConfig[mood];

  return (
    <div
      className={`
        relative w-full overflow-hidden rounded-3xl border
        bg-gradient-to-br ${cfg.border} ${cfg.bg}
        shadow-[0_4px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl
        transition-all duration-700
      `}
    >
      <div className="pointer-events-none absolute -right-8 top-0 h-full w-20 -rotate-12 bg-white/[0.02]" />

      <div className="px-5 py-4">
        {/* ── Header row ──────────────────────────────────────────── */}
        <div className="mb-3 flex items-start gap-3">
          {status === 'loading' ? (
            <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-white/10" />
          ) : (
            <SammiAvatar mood={mood} />
          )}

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-xs font-extrabold text-white">Sammi</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-white/40">
                Island Concierge
              </span>
              {/* Live badge */}
              <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-widest ${cfg.badge}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} animate-pulse`} />
                Live · r/kohsamui
              </span>
            </div>

            {/* Sammi speech bubble */}
            <div className={`relative rounded-2xl rounded-tl-none border px-3 py-2.5 ${cfg.bubble}`}>
              {status === 'loading' ? (
                <div className="space-y-2">
                  <div className="h-2 w-3/4 animate-pulse rounded bg-white/10" />
                  <div className="h-2 w-1/2 animate-pulse rounded bg-white/10" />
                </div>
              ) : (
                <p className="text-[11px] font-medium leading-relaxed text-white/90">
                  {data?.sammiSays}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Divider ─────────────────────────────────────────────── */}
        {data && (
          <>
            <div className="my-3 h-px bg-white/8" />

            {/* ── Post list ───────────────────────────────────────── */}
            <div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="mb-2 flex w-full items-center justify-between"
              >
                <p className="text-[9px] font-black uppercase tracking-widest text-white/40">
                  Community Posts · {data.posts.length} new
                </p>
                <span className="text-[9px] text-slate-500">{expanded ? '▲ hide' : '▼ show'}</span>
              </button>

              {expanded && (
                <ul className="flex flex-col gap-2">
                  {data.posts.map((post, i) => (
                    <li key={`${post.permalink}-${i}`}>
                      <a
                        href={post.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start gap-2 rounded-xl border border-white/5 bg-white/5 px-3 py-2 transition hover:bg-white/10"
                      >
                        <span className="mt-0.5 shrink-0 text-[9px] font-black text-white/25">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[10px] font-semibold leading-snug text-white/80 group-hover:text-white">
                            {post.title}
                          </p>
                          <p className="mt-0.5 text-[8px] text-slate-500">
                            ↑ {post.score} · {post.num_comments} comments · {timeAgo(post.created_utc)}
                          </p>
                        </div>
                        <span className="shrink-0 text-[8px] text-slate-600 group-hover:text-slate-400">↗</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              {/* Collapsed preview — first post title only */}
              {!expanded && data.posts[0] && (
                <a
                  href={data.posts[0].permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/5 px-3 py-2 transition hover:bg-white/10"
                >
                  <p className="min-w-0 flex-1 truncate text-[10px] font-medium text-white/60">
                    {data.posts[0].title}
                  </p>
                  <span className="shrink-0 text-[9px] text-slate-500">
                    +{data.posts.length - 1} more
                  </span>
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
