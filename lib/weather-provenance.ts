/**
 * Uniform weather provenance for Samui vacation APIs.
 * Distinguishes observation time, forecast issuance, and request-time fetch.
 */

import { SAMUI_CENTER } from './spire';
import { ageLabel, ageMinutes, type SourceFreshness } from './data-freshness';

export const CACHE_CONTROL_NO_STORE =
  'private, no-store, max-age=0, must-revalidate';

export const SAMUI_PLACE = {
  name: 'Koh Samui',
  lat: SAMUI_CENTER.lat,
  lon: SAMUI_CENTER.lon,
} as const;

/** South-Thailand vacation box: Samui, Krabi, Phuket. Never a silent global fallback. */
export const VACATION_BBOX = {
  minLat: 6.8,
  maxLat: 11.5,
  minLon: 97.5,
  maxLon: 101.5,
} as const;

export type WeatherSourceKind =
  | 'spire'
  | 'metar'
  | 'radar'
  | 'sammi_forecast'
  | 'supabase_forecast';

export interface WeatherProvenance {
  observed_at: string | null;
  issued_at: string | null;
  fetched_at: string;
  age_minutes: number | null;
  stale: boolean;
  source: WeatherSourceKind;
  stale_threshold_minutes: number;
  place?: string;
  lat?: number;
  lon?: number;
}

export function isoFromUnixSeconds(unix: number): string {
  return new Date(unix * 1000).toISOString();
}

export function unixFromIso(iso: string): number | null {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

export function isInVacationBbox(lat: number, lon: number): boolean {
  return (
    lat >= VACATION_BBOX.minLat &&
    lat <= VACATION_BBOX.maxLat &&
    lon >= VACATION_BBOX.minLon &&
    lon <= VACATION_BBOX.maxLon
  );
}

export function buildProvenance(opts: {
  source: WeatherSourceKind;
  staleAfterMinutes: number;
  observedAtIso?: string | null;
  issuedAtIso?: string | null;
  fetchedAtIso?: string;
  nowUnix?: number;
  place?: string;
  lat?: number;
  lon?: number;
}): WeatherProvenance {
  const fetched_at = opts.fetchedAtIso ?? new Date((opts.nowUnix ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const nowUnix = opts.nowUnix ?? Math.floor(Date.now() / 1000);
  const clockIso = opts.observedAtIso ?? opts.issuedAtIso ?? null;
  const clockUnix = clockIso ? unixFromIso(clockIso) : null;
  const age = clockUnix != null ? ageMinutes(clockUnix, nowUnix) : null;
  const stale = age == null ? true : age > opts.staleAfterMinutes;
  return {
    observed_at: opts.observedAtIso ?? null,
    issued_at: opts.issuedAtIso ?? null,
    fetched_at,
    age_minutes: age,
    stale,
    source: opts.source,
    stale_threshold_minutes: opts.staleAfterMinutes,
    place: opts.place,
    lat: opts.lat,
    lon: opts.lon,
  };
}

export function provenanceHeaders(p: WeatherProvenance): Record<string, string> {
  return {
    'Cache-Control': CACHE_CONTROL_NO_STORE,
    'X-Weather-Source': p.source,
    'X-Weather-Stale': p.stale ? '1' : '0',
    'X-Fetched-At': p.fetched_at,
    ...(p.observed_at ? { 'X-Observed-At': p.observed_at } : {}),
    ...(p.issued_at ? { 'X-Issued-At': p.issued_at } : {}),
    ...(p.age_minutes != null ? { 'X-Age-Minutes': String(p.age_minutes) } : {}),
    ...(p.place ? { 'X-Weather-Place': p.place } : {}),
    ...(p.lat != null ? { 'X-Weather-Lat': String(p.lat) } : {}),
    ...(p.lon != null ? { 'X-Weather-Lon': String(p.lon) } : {}),
  };
}

export function sourceFreshnessFromProvenance(p: WeatherProvenance): SourceFreshness {
  const age = p.age_minutes ?? 99999;
  const observedUnix = p.observed_at ? unixFromIso(p.observed_at) : null;
  const issuedUnix = p.issued_at ? unixFromIso(p.issued_at) : null;
  const clock = observedUnix ?? issuedUnix ?? Math.floor(new Date(p.fetched_at).getTime() / 1000);
  const syncTimeIct = new Date(clock * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  });
  return {
    ageMinutes: age,
    label: ageLabel(age),
    isStale: p.stale,
    staleThresholdMinutes: p.stale_threshold_minutes,
    sammiNote: p.stale
      ? `This ${p.source} reading is ${ageLabel(age)} — treat it as delayed, not live.`
      : null,
    syncTimeIct,
  };
}
