'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  logRainViewerFramesApiResponse,
  type RadarFramesApiResponse,
} from '@/lib/rainviewer-console-debug';
import { RADAR_FRAMES_POLL_MS } from '@/lib/rainviewer-constants';

export type RadarFrame = { path: string; time: number };

export type RadarFeedState = {
  frames: RadarFrame[];
  /** RainViewer forecast radar frames at this pin’s tile grid (Buienradar-style schedule). */
  nowcastFrames: RadarFrame[];
  status: 'loading' | 'ready' | 'error';
  latestFrame: RadarFrame | null;
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
  const [feed, setFeed] = useState<RadarFeedState>(defaultFeed);
  const value = useMemo(() => feed, [feed]);

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

  return (
    <RadarFeedContext.Provider value={value}>{children}</RadarFeedContext.Provider>
  );
}
