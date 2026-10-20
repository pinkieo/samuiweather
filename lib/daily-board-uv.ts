/**
 * Open-Meteo hourly `uv_index` for board hours whose stored UV is null.
 * Stored UV (Spire, else OpenUV at ingest) is never replaced. Hours Open-Meteo
 * does not return stay null; no zero is invented.
 */

import { SAMUI_CENTER } from '@/lib/spire';

export type BoardUvSource = 'spire' | 'openuv' | 'open-meteo';

const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';

function utcHourBucket(iso: string): number | null {
  const t = Date.parse(iso.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(t) ? Math.floor(t / 3_600_000) * 3_600_000 : null;
}

/** Parse an Open-Meteo `timezone=GMT` hourly payload into UTC hour bucket → UV. */
export function openMeteoUvHourMap(payload: unknown): Map<number, number> {
  const map = new Map<number, number>();
  const hourly = (payload as { hourly?: { time?: unknown; uv_index?: unknown } } | null)?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.uv_index)) return map;
  hourly.time.forEach((time, i) => {
    const uv = (hourly.uv_index as unknown[])[i];
    if (typeof time !== 'string' || typeof uv !== 'number' || !Number.isFinite(uv)) return;
    if (uv < 0 || uv > 25) return;
    const bucket = utcHourBucket(time);
    if (bucket != null) map.set(bucket, Math.round(uv * 10) / 10);
  });
  return map;
}

export async function fetchOpenMeteoUvHourMap(
  startUtc: Date,
  endUtc: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, number> | null> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const url =
    `${OPEN_METEO_FORECAST}?latitude=${SAMUI_CENTER.lat}&longitude=${SAMUI_CENTER.lon}` +
    `&hourly=uv_index&timezone=GMT&start_date=${day(startUtc)}&end_date=${day(new Date(endUtc.getTime() - 1))}`;
  try {
    const res = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.error(`[daily-board] Open-Meteo UV status ${res.status}`);
      return null;
    }
    return openMeteoUvHourMap(await res.json());
  } catch (err) {
    console.error('[daily-board] Open-Meteo UV failed', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Fill null `uvIndex` hours from the Open-Meteo map and mark their source. */
export function fillMissingUv<T extends { timeUtc: string; uvIndex: number | null; uvSource?: BoardUvSource | null }>(
  hours: T[],
  openMeteo: Map<number, number> | null,
): T[] {
  return hours.map((hour) => {
    if (hour.uvIndex != null || !openMeteo) return hour;
    const bucket = utcHourBucket(hour.timeUtc);
    const uv = bucket == null ? undefined : openMeteo.get(bucket);
    return uv == null ? hour : { ...hour, uvIndex: uv, uvSource: 'open-meteo' as const };
  });
}

const SOURCE_NAMES: Record<BoardUvSource, string> = {
  spire: 'Spire',
  openuv: 'OpenUV',
  'open-meteo': 'Open-Meteo',
};

/** One guest line naming where the UV row came from. Null when no hour has UV. */
export function uvSourceNote(sources: (BoardUvSource | null | undefined)[]): string | null {
  const used = [...new Set(sources.filter((s): s is BoardUvSource => !!s))];
  if (!used.length) return null;
  return `UV index: ${used.map((s) => SOURCE_NAMES[s]).join(' + ')} forecast.`;
}
