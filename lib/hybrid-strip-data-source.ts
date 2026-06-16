import { HYBRID_STRIP_PAST_COUNT } from '@/lib/hybrid-rain-timeline';

/** Strip hour index (0…n-1) → clock offset vs current Bangkok hour (0 = now). */
export function stripBarIndexToClockOffset(
  barIndex: number,
  pastHoursBeforeNow = HYBRID_STRIP_PAST_COUNT,
): number {
  return barIndex - pastHoursBeforeNow;
}
export type HybridStripDataSource = 'rainviewer' | 'spire';

/**
 * Past + current hour: RainViewer scrub / snapshot.
 * Future hours: Spire forecast fields (no RainViewer tile at forecast time).
 */
export function dataSourceForClockOffset(offset: number): HybridStripDataSource {
  return offset <= 0 ? 'rainviewer' : 'spire';
}
