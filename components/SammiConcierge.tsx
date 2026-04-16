'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { SammiResponse } from '../app/api/reddit/route';
import type { SammiChatResponse } from '../app/api/sammi/chat/route';
import type { SamuiWeatherForecastRow } from '../lib/spire';

// ─── Mood palette ─────────────────────────────────────────────────────────────

const moodCfg = {
  positive: {
    glow:   'shadow-[0_0_32px_8px_rgba(52,211,153,0.35)]',
    ring:   'ring-emerald-400/70',
    bubble: 'border-emerald-500/20 bg-emerald-950/40',
    badge:  'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    dot:    'bg-emerald-400',
    accent: 'text-emerald-400',
    input:  'focus:ring-emerald-500/40',
    send:   'bg-emerald-600 hover:bg-emerald-500',
  },
  cautious: {
    glow:   'shadow-[0_0_32px_8px_rgba(251,191,36,0.30)]',
    ring:   'ring-amber-400/70',
    bubble: 'border-amber-500/20 bg-amber-950/40',
    badge:  'bg-amber-500/15 text-amber-300 border-amber-500/25',
    dot:    'bg-amber-400',
    accent: 'text-amber-400',
    input:  'focus:ring-amber-500/40',
    send:   'bg-amber-600 hover:bg-amber-500',
  },
  alert: {
    glow:   'shadow-[0_0_32px_8px_rgba(251,113,133,0.35)]',
    ring:   'ring-rose-400/70',
    bubble: 'border-rose-500/20 bg-rose-950/40',
    badge:  'bg-rose-500/15 text-rose-300 border-rose-500/25',
    dot:    'bg-rose-400',
    accent: 'text-rose-400',
    input:  'focus:ring-rose-500/40',
    send:   'bg-rose-600 hover:bg-rose-500',
  },
  neutral: {
    glow:   'shadow-[0_0_24px_6px_rgba(148,163,184,0.20)]',
    ring:   'ring-slate-400/40',
    bubble: 'border-white/10 bg-white/5',
    badge:  'bg-white/10 text-slate-300 border-white/15',
    dot:    'bg-slate-400',
    accent: 'text-slate-300',
    input:  'focus:ring-slate-500/40',
    send:   'bg-slate-600 hover:bg-slate-500',
  },
};

// ─── Daily Steer ──────────────────────────────────────────────────────────────

interface DailySteer {
  text:     string;
  category: 'weather' | 'event' | 'beach' | 'sunset' | 'clear';
  icon:     string;
}

const DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

function getDailySteer(rows: SamuiWeatherForecastRow[]): DailySteer {
  const now  = rows[0];
  const soon = rows.slice(1, 3);

  // Thailand local time
  const ict     = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const hour    = ict.getHours();
  const day     = ict.getDay(); // 0=Sun … 6=Sat
  const eve     = hour >= 17;
  const isMarketNight = [1, 3, 5].includes(day) && eve; // Mon, Wed, Fri
  const isFriday      = day === 5 && eve;
  const dayNames      = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // 1 — Active heavy rain
  if (now?.precipRate > 2) return {
    text:     'Active precipitation on radar. Redirect to covered assets: Ark Bar roof, Carnival Beach Club main shelter, or Coco Tam\'s. Check the Live Radar panel for timing.',
    category: 'weather', icon: '⛈️',
  };

  // 2 — Rain building within 2 hours
  if (soon.some(r => r.precipRate > 1.5)) return {
    text:     'Satellite intelligence shows precipitation building within 2 hours. Secure outdoor positions now. Covered options: Ark Bar, Carnival Beach Club, Coco Tam\'s.',
    category: 'weather', icon: '🌧️',
  };

  // 3 — Wind advisory
  if (now?.windSpeed > 18) {
    const wc = DIRS[Math.round((now.windDir ?? 0) / 22.5) % 16];
    if (['NE','ENE','E','ESE'].includes(wc)) return {
      text:     `NE/E wind vector active — east coast exposure elevated. Tactical redirect: Lipa Noi or Bang Por on the west side for calm-water operations.`,
      category: 'weather', icon: '💨',
    };
  }

  // 4 — Friday Walking Street
  if (isFriday) return {
    text:     'Tonight: Fisherman\'s Village Walking Street is active. Park near The Wharf and enter from the east side to avoid the main-entrance gridlock. Arrive before 18:30 for dinner without a wait.',
    category: 'event', icon: '🏮',
  };

  // 5 — Mon / Wed night market
  if (isMarketNight) return {
    text:     `Night market at Fisherman's Village tonight (${dayNames[day]}). Enter from the east end — the main gate is gridlocked. Park near The Wharf and walk in from there.`,
    category: 'event', icon: '🏮',
  };

  // 6 — Morning window
  if (hour >= 5 && hour < 10) return {
    text:     'Morning window: Choeng Mon for calm water and minimal crowd density. Wat Plai Laem near Bang Rak — go before 09:00, before the tour buses arrive.',
    category: 'beach', icon: '🌅',
  };

  // 7 — Peak beach window
  if (hour >= 10 && hour < 16) return {
    text:     'Peak beach window. Choeng Mon for families — water stays shallow for 100m, Carnival Beach Club operational. Chaweng central for the full island experience.',
    category: 'beach', icon: '🏖️',
  };

  // 8 — Sunset window
  if (eve) return {
    text:     'Sunset window: ~18:30. Primary position: Lipa Noi west coast. Samui Yacht Club for the full setup. Bophut Fisherman\'s Village if you\'re already in the north.',
    category: 'sunset', icon: '🌇',
  };

  // Default
  return {
    text:     'No active weather alerts. Choeng Mon and Chaweng both operational. Ask below for specific tactical advice.',
    category: 'clear', icon: '✅',
  };
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ sammiMood }: { sammiMood: SammiResponse['sammiMood'] }) {
  const cfg = moodCfg[sammiMood];
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div className="relative flex shrink-0 flex-col items-center gap-1">
      <div className={`relative h-[64px] w-[64px] rounded-full ring-[3px] ${cfg.ring} ${cfg.glow} transition-all duration-700`}>
        {!imgFailed ? (
          <img src="/assets/sammi-avatar.png" alt="Sammi"
            className="h-full w-full rounded-full object-cover object-top"
            onError={() => setImgFailed(true)} />
        ) : (
          <div className="flex h-full w-full items-end justify-center overflow-hidden rounded-full bg-gradient-to-br from-rose-400 via-pink-500 to-purple-600">
            <svg viewBox="0 0 64 80" className="w-full" fill="none">
              <ellipse cx="32" cy="24" rx="12" ry="14" fill="#fde3c8" />
              <path d="M20 24 Q20 14 32 12 Q44 14 44 24" fill="#3b1a08" />
              <path d="M16 28 Q18 22 32 22 Q46 22 48 28 L50 80 H14 Z" fill="#e879a0" opacity="0.85" />
              <ellipse cx="32" cy="38" rx="14" ry="8" fill="#fde3c8" />
            </svg>
          </div>
        )}
        <span className={`absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-900 ${cfg.dot} animate-pulse`} />
      </div>
      <p className="text-[8px] font-black uppercase tracking-widest text-white/70">SAMMI</p>
      <p className={`text-[7px] font-bold uppercase tracking-wider ${cfg.accent}`}>Weather expert</p>
    </div>
  );
}

// ─── Chat message ─────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'sammi';
  text: string;
  sources?: { title: string; url: string }[];
  usedVectorSearch?: boolean;
}

// ─── ConflictStatus ───────────────────────────────────────────────────────────

interface ConflictStatus {
  scenario:          string;
  confidence:        string;
  isAlert:           boolean;
  spireRain:         boolean;
  meteoblueRain:     boolean;
  satelliteDisagree: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SammiConcierge({
  forecastRows = [],
  onMapFlyTo,
}: {
  forecastRows?: SamuiWeatherForecastRow[];
  /** When Sammi returns `mapFlyTo` from chat API, parent pans the Mapbox map */
  onMapFlyTo?: (locationId: string) => void;
}) {
  const [redditData, setRedditData]   = useState<SammiResponse | null>(null);
  const [chatInput, setChatInput]     = useState('');
  const [chatMsgs, setChatMsgs]       = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [conflictStatus, setConflictStatus] = useState<ConflictStatus | null>(null);

  const inputRef      = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Fetch conflict status
  useEffect(() => {
    fetch('/api/conflict-status')
      .then(r => r.ok ? r.json() : null)
      .then((d: { scenario: string; confidence: string; isAlert: boolean; statusBoard?: { source: string; verdict: string }[] } | null) => {
        if (!d) return;
        const board    = d.statusBoard ?? [];
        const orbital  = board.find(s => s.source.includes('Orbital'));
        const spireRain = orbital?.verdict === 'RAIN' || orbital?.verdict === 'STORM';
        const satelliteDisagree = d.confidence === 'medium' && !d.isAlert;
        const meteoblueRain     = satelliteDisagree ? !spireRain : spireRain;
        setConflictStatus({ scenario: d.scenario, confidence: d.confidence, isAlert: d.isAlert, spireRain, meteoblueRain, satelliteDisagree });
      })
      .catch(() => {});
  }, []);

  // Fetch Reddit sammiSays
  useEffect(() => {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch('/api/reddit', { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then((json: SammiResponse | null) => { clearTimeout(timer); if (json) setRedditData(json); })
      .catch(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, []);

  // Auto-focus input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [chatMsgs, chatLoading]);

  const sendMessage = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    setChatMsgs(prev => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);

    const now = forecastRows[0];
    try {
      const res  = await fetch('/api/sammi/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          weatherContext: now ? {
            temp:              now.temp,
            precipRate:        now.precipRate,
            windSpeed:         now.windSpeed,
            windDir:           now.windDir,
            conflictScenario:  conflictStatus?.scenario ?? null,
            satelliteDisagree: conflictStatus?.satelliteDisagree ?? false,
            spireRain:         conflictStatus?.spireRain ?? false,
            meteoblueRain:     conflictStatus?.meteoblueRain ?? false,
          } : undefined,
        }),
      });
      const json = await res.json() as SammiChatResponse & { error?: string };
      const replyText = json.reply ?? json.error ?? 'Signal lost. Try again.';
      if (json.mapFlyTo && onMapFlyTo) onMapFlyTo(json.mapFlyTo);
      setChatMsgs(prev => [...prev, {
        role:            'sammi',
        text:            replyText,
        sources:         json.sources ?? [],
        usedVectorSearch: json.usedVectorSearch,
      }]);
    } catch {
      setChatMsgs(prev => [...prev, { role: 'sammi', text: 'Signal lost. Try again in a moment.' }]);
    } finally {
      setChatLoading(false);
      // Re-focus input after response
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const sammiMood = redditData?.sammiMood ?? 'neutral';
  const cfg       = moodCfg[sammiMood];
  const steer     = getDailySteer(forecastRows);
  const now       = forecastRows[0];

  return (
    <div className="mb-4 w-full">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/90 via-slate-800/60 to-slate-900/90 backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-10 top-0 h-full w-24 -rotate-12 bg-white/[0.025]" />

        {/* ── Samui weather expert · briefing card ───────────────────────── */}
        <div className="flex items-start gap-3 px-4 py-4">
          <Avatar sammiMood={sammiMood} />

          <div className="min-w-0 flex-1 space-y-2">

            {/* SITREP row */}
            {now && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-widest ${cfg.badge}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} animate-pulse`} />
                  Live conditions
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[8px] font-bold text-white/50">
                  {Math.round(now.temp)}°C
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[8px] font-bold text-white/50">
                  {now.precipRate > 0 ? `${now.precipRate.toFixed(1)} mm/h` : 'No rain'}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[8px] font-bold text-white/50">
                  {DIRS[Math.round((now.windDir ?? 0) / 22.5) % 16]} {Math.round(now.windSpeed)} kts
                </span>
              </div>
            )}

            {/* Steer of the moment */}
            <div className={`rounded-xl border px-3 py-2.5 ${cfg.bubble}`}>
              <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-white/35">
                {steer.icon} Daily Steer
              </p>
              <p className="text-[11px] font-medium leading-relaxed text-white/90">
                {steer.text}
              </p>
              {/* Reddit sammiSays as secondary note */}
              {redditData?.sammiSays && (
                <p className="mt-1.5 text-[10px] italic leading-relaxed text-white/40">
                  {redditData.sammiSays}
                </p>
              )}
            </div>

            {/* CTA */}
            <p className="text-[9px] font-semibold text-white/30">
              Ask the Samui weather expert — beaches, rain windows, or tonight&apos;s plan ↓
            </p>
          </div>
        </div>

        {/* ── Chat — always open, zero gap from intelligence card ─────────── */}
        <div className="flex flex-col px-4 pb-4">

          {/* Message history */}
          <div
            ref={chatScrollRef}
            className="mb-2 flex max-h-52 flex-col gap-2 overflow-y-auto pr-1"
          >
            {chatMsgs.length === 0 && (
              <p className="py-1 text-center text-[10px] text-white/20">
                Samui weather expert standing by…
              </p>
            )}
            {chatMsgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`
                  max-w-[88%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed
                  ${m.role === 'user'
                    ? 'rounded-br-sm bg-white/10 text-white/80'
                    : `rounded-bl-sm border text-white/90 ${cfg.bubble}`}
                `}>
                  {m.text}
                  {m.usedVectorSearch && (m.sources?.length ?? 0) > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.sources!.slice(0, 2).map((s, j) => (
                        <a key={j} href={s.url} target="_blank" rel="noopener noreferrer"
                          className="inline-block max-w-[120px] truncate rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8px] text-white/40 transition hover:text-white/70">
                          ↗ {s.title.slice(0, 24)}…
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="flex justify-start">
                <div className={`rounded-2xl rounded-bl-sm border px-4 py-2.5 text-[11px] ${cfg.bubble}`}>
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce" style={{ animationDelay: '0ms'   }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                    <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Input row — sticky at the bottom of the chat section */}
          <form
            onSubmit={(e) => { e.preventDefault(); void sendMessage(); }}
            className="sticky bottom-0 flex items-center gap-2 bg-transparent pt-1"
            suppressHydrationWarning
          >
            <input
              ref={inputRef}
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Beach conditions? Market tonight? Best sunset spot?"
              disabled={chatLoading}
              suppressHydrationWarning
              className={`
                flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2
                text-[11px] text-white placeholder-white/25
                outline-none ring-0 focus:ring-1 ${cfg.input}
                transition disabled:opacity-50
              `}
            />
            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              suppressHydrationWarning
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white transition ${cfg.send} disabled:opacity-40`}
            >
              <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
