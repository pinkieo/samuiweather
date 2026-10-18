'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const BOARD_W = 1280;
const BOARD_H = 720;

type FullscreenHost = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

function currentFullscreen(): Element | null {
  const doc = document as FullscreenDoc;
  return document.fullscreenElement || doc.webkitFullscreenElement || null;
}

/**
 * Click or tap the board to fill the display. Click again, or Escape, leaves
 * fullscreen. The 1280×720 frame is scaled, not restacked, so the presenter
 * gutter stays on the left.
 */
export default function BoardFullscreen({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [scale, setScale] = useState(1);

  const fit = useCallback(() => {
    const root = rootRef.current;
    if (!root || currentFullscreen() !== root) {
      setActive(false);
      setScale(1);
      return;
    }
    const next = Math.min(root.clientWidth / BOARD_W, root.clientHeight / BOARD_H);
    setActive(true);
    setScale(next > 0 ? next : 1);
  }, []);

  useEffect(() => {
    document.addEventListener('fullscreenchange', fit);
    document.addEventListener('webkitfullscreenchange', fit);
    window.addEventListener('resize', fit);
    return () => {
      document.removeEventListener('fullscreenchange', fit);
      document.removeEventListener('webkitfullscreenchange', fit);
      window.removeEventListener('resize', fit);
    };
  }, [fit]);

  async function toggle() {
    const root = rootRef.current;
    if (!root) return;
    const doc = document as FullscreenDoc;
    try {
      if (currentFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
        return;
      }
      const host = root as FullscreenHost;
      if (host.requestFullscreen) await host.requestFullscreen();
      else await host.webkitRequestFullscreen?.();
    } catch (err) {
      console.error('[daily-board] fullscreen', err instanceof Error ? err.message : err);
    }
  }

  const grown = active ? scale : 1;

  return (
    <div
      ref={rootRef}
      data-board-fullscreen={active ? 'on' : 'off'}
      aria-label={active ? 'Exit full screen' : 'Full screen'}
      onClick={() => void toggle()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void toggle();
      }}
      tabIndex={0}
      className="inline-flex cursor-pointer items-center justify-center bg-black outline-none fullscreen:flex fullscreen:h-full fullscreen:w-full"
    >
      <div className="relative" style={{ width: BOARD_W * grown, height: BOARD_H * grown }}>
        <div
          style={
            active
              ? {
                  width: BOARD_W,
                  height: BOARD_H,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }
              : undefined
          }
        >
          {children}
          <p
            data-board-fullscreen-hint
            className="pointer-events-none absolute bottom-3 left-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9ec9c2]"
          >
            {active ? 'Tap to exit' : 'Tap for full screen'}
          </p>
        </div>
      </div>
    </div>
  );
}
