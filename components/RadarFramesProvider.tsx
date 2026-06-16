'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  logRainViewerFramesApiResponse,
  type RadarFramesApiResponse,
} from '@/lib/rainviewer-console-debug';
import { RADAR_FRAMES_POLL_MS } from '@/lib/rainviewer-constants';

/**
 * RainViewer feed metadata — not persisted in this app.
 *
 * Source JSON: https://api.rainviewer.com/public/weather-maps.json (proxied by `/api/radar/frames`).
 * The `past` array typically covers roughly **2–3 hours** of scans at ~10 min cadence (no long archive).
 * We only keep **path + Unix time** per frame in memory for the running session.
 */

export type RadarFrame = { path: string; time: number };

export type RadarFeedState = {
  frames: RadarFrame[];
  /** RainViewer forecast radar frames at this pin’s tile grid (Buienradar-style schedule). */
  nowcastFrames: RadarFrame[];
  status: 'loading' | 'ready' | 'error';
  latestFrame: RadarFrame | null;
  /** Pull `/api/radar/frames` immediately (e.g. LIVE badge). */
  refresh: () => void;
};

function pickLatestFrame(frames: RadarFrame[]): RadarFrame | null {
  if (frames.length === 0) return null;
  let best = frames[0]!;
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!;
    if (f.time > best.time) best = f;
  }
  return best;
}

const defaultFeed: RadarFeedState = {
  frames: [],
  nowcastFrames: [],
  status: 'loading',
  latestFrame: null,
  refresh: () => {},
};

const RadarFeedContext = createContext<RadarFeedState>(defaultFeed);

/** Full feed + status — dashboard radar dot does not wait for the map. */
export function useRadarFeed(): RadarFeedState {
  return useContext(RadarFeedContext);
}

/** Frame list only — map layer. */
export function useRadarFrames(): RadarFrame[] {
  return useContext(RadarFeedContext).frames;
}

/**
 * `/api/radar/frames` bij mount (root layout) + poll. `logRainViewerFramesApiResponse` na elke geldige JSON
 * (ingest PHU/SRT/SKA-proof in console).
 */
export function RadarFramesProvider({ children }: { children: ReactNode }) {
  const [feed, setFeed] = useState<Omit<RadarFeedState, 'refresh'>>({
    frames: [],
    nowcastFrames: [],
    status: 'loading',
    latestFrame: null,
  });

  const loadLiveFramesRef = useRef<() => Promise<boolean>>(async () => false);

  useEffect(() => {
    let cancelled = false;
    let pollId: number | undefined;

    /** @returns false = HTTP or parse error; practice snapshot may be used as fallback. */
    async function loadLiveFrames(): Promise<boolean> {
      try {
        const r = await fetch('/api/radar/frames', { cache: 'no-store' });
        let data: RadarFramesApiResponse;
        try {
          data = (await r.json()) as RadarFramesApiResponse;
        } catch {
          data = { frames: [] };
        }
        if (!r.ok && data.error == null) {
          data = { ...data, error: `http_${r.status}` };
        }

        const list = data.frames ?? [];
        const nowcast = data.nowcastFrames ?? [];
        logRainViewerFramesApiResponse({ ...data, feedSource: 'api' });

        if (cancelled) return true;

        if (!r.ok) {
          if (list.length === 0) {
            setFeed({
              frames: [],
              nowcastFrames: [],
              status: 'error',
              latestFrame: null,
            });
          }
          return false;
        }

        setFeed({
          frames: list,
          nowcastFrames: nowcast,
          status: 'ready',
          latestFrame: pickLatestFrame(list),
        });
        return true;
      } catch {
        if (!cancelled) {
          setFeed({
            frames: [],
            nowcastFrames: [],
            status: 'error',
            latestFrame: null,
          });
        }
        return false;
      }
    }

    loadLiveFramesRef.current = () => loadLiveFrames();

    async function tryLoadPracticeSnapshot(): Promise<boolean> {
      for (const url of ['/radar-practice.json', '/radar-practice.fixture.json'] as const) {
        try {
          const r = await fetch(url, { cache: 'no-store' });
          if (!r.ok) continue;
          const data = (await r.json()) as RadarFramesApiResponse;
          const list = data.frames ?? [];
          if (list.length > 0) {
            logRainViewerFramesApiResponse({ ...data, feedSource: 'practice_file' });
            if (!cancelled) {
              setFeed({
                frames: list,
                nowcastFrames: data.nowcastFrames ?? [],
                status: 'ready',
                latestFrame: pickLatestFrame(list),
              });
            }
            return true;
          }
        } catch {
          /* try next url */
        }
      }
      return false;
    }

    void (async () => {
      const practice = process.env.NEXT_PUBLIC_RADAR_PRACTICE === '1';
      const liveOk = await loadLiveFrames();
      if (cancelled) return;
      if (!liveOk && practice) {
        const snapshotOk = await tryLoadPracticeSnapshot();
        if (!snapshotOk && !cancelled) {
          console.warn(
            '[radar] Live /api/radar/frames failed and NEXT_PUBLIC_RADAR_PRACTICE=1 — no usable radar-practice.json / radar-practice.fixture.json snapshot',
          );
        }
      }
      if (cancelled) return;
      pollId = window.setInterval(() => void loadLiveFrames(), RADAR_FRAMES_POLL_MS);
    })();

    return () => {
      cancelled = true;
      if (pollId !== undefined) window.clearInterval(pollId);
    };
  }, []);

  const refresh = useCallback(() => {
    void loadLiveFramesRef.current();
  }, []);

  const value = useMemo(
    () => ({ ...feed, refresh }),
    [feed, refresh],
  );

  return (
    <RadarFeedContext.Provider value={value}>{children}</RadarFeedContext.Provider>
  );
}
