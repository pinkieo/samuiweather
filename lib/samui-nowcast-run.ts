/**
 * Runs the Samui nowcast after a successful Spire ingest.
 * Tile or database failures are reported on the decision; they do not throw.
 */

import { ECOWITT_LOCATION_ID } from './ecowitt-data';
import { decodeRainviewerPngToRgba } from './rainviewer-server-sample';
import { latLonToRainviewerTileFraction, RAINVIEWER_NATIVE_Z } from './rainviewer-tile-math';
import {
  evaluateSamuiNowcast,
  publishFlagFromEnv,
  readSpireLevelWind,
  SAMUI_NOWCAST_PIN,
  SAMUI_NOWCAST_STALE_SEC,
  SAMUI_RADAR_ARCHIVE_RETENTION_DAYS,
  type NowcastDecision,
  type RadarScan,
  type StationSample,
} from './samui-nowcast';
import {
  coverageRadiusKm,
  parseRainViewerMaps,
  scanTileReflectivity,
  type RainViewerFrameRef,
} from './samui-nowcast-radar';
import { getSupabaseAdmin } from './supabase-admin';

const MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const FRAMES_TO_FETCH = 4;

export type NowcastRunArgs = {
  nowUnix?: number;
  locationId: string;
  lat?: number;
  lon?: number;
  hours: { validTimeUnix: number; popPct: number | null }[];
  spireValues: Record<string, unknown> | null;
};

async function fetchCatalog(signal: AbortSignal): Promise<unknown | null> {
  const res = await fetch(MAPS_URL, {
    headers: { 'User-Agent': 'SamuiWeatherDashboard/1.0' },
    signal,
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchTile(
  host: string,
  frame: RainViewerFrameRef,
  lat: number,
  lon: number,
  signal: AbortSignal,
): Promise<{ scan: RadarScan; reliable: boolean } | null> {
  const { xTile, yTile } = latLonToRainviewerTileFraction(lat, lon, RAINVIEWER_NATIVE_Z);
  const url = `${host}${frame.path}/512/${RAINVIEWER_NATIVE_Z}/${xTile}/${yTile}/2/0_0.png`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SamuiWeatherDashboard/1.0' },
    signal,
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const decoded = decodeRainviewerPngToRgba(bytes);
  if (!decoded) return null;
  const scanned = scanTileReflectivity({
    rgba: decoded.rgba,
    width: decoded.width,
    height: decoded.height,
    xTile,
    yTile,
  });
  const reliable = scanned.opaquePixels === 0 || scanned.matchedPixels / scanned.opaquePixels >= 0.8;
  return {
    reliable,
    scan: { timeUnix: frame.time, kind: 'past', cells: reliable ? scanned.cells : [] },
  };
}

async function loadStation(nowUnix: number): Promise<StationSample[] | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const since = new Date((nowUnix - 40 * 60) * 1000).toISOString();
  const { data, error } = await sb
    .from('ecowitt_observations')
    .select('observed_at,temperature_c,wind_speed_ms,wind_gust_ms,wind_direction_deg')
    .eq('location_id', ECOWITT_LOCATION_ID)
    .gte('observed_at', since)
    .order('observed_at', { ascending: true })
    .limit(80);
  if (error || !data) return null;
  return data.map((row) => ({
    timeUnix: Math.floor(Date.parse(String(row.observed_at)) / 1000),
    tempC: typeof row.temperature_c === 'number' ? row.temperature_c : null,
    windSpeedMs: typeof row.wind_speed_ms === 'number' ? row.wind_speed_ms : null,
    windGustMs: typeof row.wind_gust_ms === 'number' ? row.wind_gust_ms : null,
    windFromDeg: typeof row.wind_direction_deg === 'number' ? row.wind_direction_deg : null,
  }));
}

async function persist(locationId: string, decision: NowcastDecision, scans: RadarScan[]): Promise<void> {
  const sb = getSupabaseAdmin();
  if (!sb) return;
  const { error } = await sb.from('samui_nowcast_run').insert({
    location_id: locationId,
    ran_at_utc: new Date().toISOString(),
    state: decision.state,
    reason: decision.reason,
    radar_time_utc: decision.radarTimeUnix ? new Date(decision.radarTimeUnix * 1000).toISOString() : null,
    eta_source: decision.eta?.source ?? null,
    eta_earliest_utc: decision.eta ? new Date(decision.eta.earliestUnix * 1000).toISOString() : null,
    eta_latest_utc: decision.eta ? new Date(decision.eta.latestUnix * 1000).toISOString() : null,
    provenance: decision,
  });
  if (error) {
    console.warn(`[samui-nowcast] provenance not stored (${error.message}). Apply supabase/025_samui_nowcast.sql before production.`);
  }
  if (scans.length) {
    const rows = scans.map((scan) => ({
      location_id: locationId,
      frame_time_utc: new Date(scan.timeUnix * 1000).toISOString(),
      kind: scan.kind,
      cells: scan.cells,
    }));
    const { error: archiveError } = await sb.from('samui_radar_archive').insert(rows);
    if (archiveError) {
      console.warn(`[samui-nowcast] radar archive not stored (${archiveError.message}).`);
    }
  }
  const { error: purgeError } = await sb.rpc('purge_samui_radar_archive', {
    p_retention_days: SAMUI_RADAR_ARCHIVE_RETENTION_DAYS,
  });
  if (purgeError) {
    console.warn(`[samui-nowcast] archive purge skipped (${purgeError.message}).`);
  }
}

export async function runSamuiNowcastAfterIngest(args: NowcastRunArgs): Promise<NowcastDecision> {
  const nowUnix = args.nowUnix ?? Math.floor(Date.now() / 1000);
  const lat = args.lat ?? SAMUI_NOWCAST_PIN.lat;
  const lon = args.lon ?? SAMUI_NOWCAST_PIN.lon;
  const wind700 = readSpireLevelWind(args.spireValues, '700');
  const wind850 = readSpireLevelWind(args.spireValues, '850');
  const wind500 = readSpireLevelWind(args.spireValues, '500');
  const station = await loadStation(nowUnix).catch(() => null);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  let decision: NowcastDecision;
  let storedScans: RadarScan[] = [];
  try {
    const json = await fetchCatalog(ac.signal).catch(() => null);
    const catalog = json ? parseRainViewerMaps(json) : null;
    if (!catalog || catalog.past.length === 0) {
      decision = evaluateSamuiNowcast({
        nowUnix,
        pin: { lat, lon },
        scans: catalog ? [] : null,
        reflectivityKnown: false,
        wind700,
        wind850,
        wind500,
        station,
        hours: args.hours,
        publishCalibratedLowering: publishFlagFromEnv(),
      });
    } else {
      const latest = catalog.past[catalog.past.length - 1]!;
      const age = Math.max(0, nowUnix - latest.time);
      const host = catalog.host ?? 'https://tilecache.rainviewer.com';
      if (age > SAMUI_NOWCAST_STALE_SEC) {
        decision = evaluateSamuiNowcast({
          nowUnix,
          pin: { lat, lon },
          scans: catalog.past.map((frame) => ({ timeUnix: frame.time, kind: 'past', cells: [] })),
          reflectivityKnown: true,
          coverageRadiusKm: coverageRadiusKm(lat, lon),
          wind700,
          wind850,
          wind500,
          station,
          hours: args.hours,
          publishCalibratedLowering: publishFlagFromEnv(),
        });
      } else {
        const frames = catalog.past.slice(-FRAMES_TO_FETCH);
        const tiles = await Promise.all(
          frames.map((frame) => fetchTile(host, frame, lat, lon, ac.signal).catch(() => null)),
        );
        const decoded = tiles.filter((tile): tile is { scan: RadarScan; reliable: boolean } => tile != null);
        const scans = decoded.map((tile) => tile.scan);
        storedScans = scans;
        const reflectivityKnown = decoded.length === frames.length && decoded.every((tile) => tile.reliable);
        decision = evaluateSamuiNowcast({
          nowUnix,
          pin: { lat, lon },
          scans,
          reflectivityKnown,
          coverageRadiusKm: coverageRadiusKm(lat, lon),
          wind700,
          wind850,
          wind500,
          station,
          hours: args.hours,
          publishCalibratedLowering: publishFlagFromEnv(),
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'radar fetch failed';
    decision = evaluateSamuiNowcast({
      nowUnix,
      pin: { lat, lon },
      scans: null,
      reflectivityKnown: false,
      wind700,
      wind850,
      wind500,
      station,
      hours: args.hours,
      publishCalibratedLowering: publishFlagFromEnv(),
    });
    decision = { ...decision, reason: `Radar fetch failed (${message}). Model forecast left unchanged.` };
  } finally {
    clearTimeout(timer);
  }

  console.info(
    `[samui-nowcast] ${decision.state}: ${decision.reason}` +
      (decision.eta
        ? ` ETA ${decision.eta.earliestMin}–${decision.eta.latestMin} min via ${decision.eta.source}.`
        : ''),
  );
  await persist(args.locationId, decision, storedScans).catch((err) => {
    console.warn('[samui-nowcast] persist failed', err instanceof Error ? err.message : err);
  });
  return decision;
}
