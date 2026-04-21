import { useCallback, useEffect, useRef } from 'react';

/**
 * Batches map `onMove` view-state updates to at most **once per animation frame** so React
 * does not re-render the whole map stack on every pointer/mouse event (was amplifying MapLibre
 * “mouseover” / tile work and triggering long-task violations).
 */
export function useHudThrottleMove(
  onApply: (zoom: number, latitude: number) => void,
): (evt: { viewState: { zoom: number; latitude: number } }) => void {
  const latest = useRef({ zoom: 0, lat: 0 });
  const rafId = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    },
    [],
  );

  return useCallback(
    (evt: { viewState: { zoom: number; latitude: number } }) => {
      latest.current = {
        zoom: evt.viewState.zoom,
        lat: evt.viewState.latitude,
      };
      if (rafId.current != null) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        const { zoom, lat } = latest.current;
        onApply(zoom, lat);
      });
    },
    [onApply],
  );
}
