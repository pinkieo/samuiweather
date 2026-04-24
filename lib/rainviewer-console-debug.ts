/**
 * Browser console helper — logs RainViewer `/api/radar/frames` payload (upstream + now frame).
 * Public `weather-maps.json` usually has no `radars[]` with PHU/SRT/SKA; we surface that explicitly.
 */

import type { RainViewerIngestProof } from './rainviewer-ingest-proof';

export type RadarFramesApiResponse = {
  frames?: { path: string; time: number }[];
  /** RainViewer `radar.nowcast` — short extrapolated radar loop (future frames). */
  nowcastFrames?: { path: string; time: number }[];
  nowFrame?: { path: string; time: number } | null;
  /** Full snapshot of `https://api.rainviewer.com/public/weather-maps.json` */
  upstream?: unknown;
  error?: string;
  /** Audit: PHU / SRT / SKA vs composite path (no per-station IDs inside JSON). */
  ingest?: RainViewerIngestProof;
  /** Client only: payload source (practice snapshot has no `upstream`). */
  feedSource?: 'api' | 'practice_file';
};

function collectRadarRelatedKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [];
  const keys: string[] = [];
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (/radar/i.test(k)) keys.push(p);
    if (typeof o[k] === 'object' && o[k] !== null && !Array.isArray(o[k])) {
      keys.push(...collectRadarRelatedKeys(o[k], p));
    }
  }
  return keys;
}

/** Find nested `radars` properties (any shape). */
function findRadarsLists(obj: unknown): { path: string; value: unknown }[] {
  const out: { path: string; value: unknown }[] = [];
  function walk(x: unknown, path: string) {
    if (x === null || typeof x !== 'object') return;
    if (Array.isArray(x)) {
      for (let i = 0; i < Math.min(x.length, 3); i++) walk(x[i], `${path}[${i}]`);
      return;
    }
    const o = x as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const p = path ? `${path}.${k}` : k;
      if (k.toLowerCase() === 'radars') {
        out.push({ path: p, value: o[k] });
      }
      walk(o[k], p);
    }
  }
  walk(obj, '');
  return out;
}

export function logRainViewerFramesApiResponse(data: RadarFramesApiResponse): void {
  if (typeof window === 'undefined') return;

  const { upstream, nowFrame, frames, error, ingest, feedSource } = data;

  console.groupCollapsed(
    '[RainViewer] metadata — now frame + upstream weather-maps.json (via /api/radar/frames)',
  );

  if (ingest) {
    console.log('━━ Audit (Phuket PHU · Surat Thani SRT · Sathing Phra SKA vs composite) ━━');
    console.log('Station IDs on RainViewer Thailand index:', ingest.stationsOnRainViewerIndex);
    console.info(ingest.compositeTileSemantics);
    console.info(ingest.howThisRelatesToCompositeDownload);
    console.log('Full ingest object:', ingest);
  }

  if (feedSource === 'practice_file') {
    console.info(
      'Source: local snapshot file (NEXT_PUBLIC_RADAR_PRACTICE fallback) — no `upstream` field; audit uses fixed ingest copy.',
    );
  } else if (feedSource === 'api') {
    console.info('Source: live GET /api/radar/frames → https://api.rainviewer.com/public/weather-maps.json');
  }

  if (error) {
    console.warn('/api/radar/frames error flag:', error);
  }
  console.log("Active / 'now' frame (newest scan in our window array):", nowFrame ?? null);
  console.log('Frames in response (count):', frames?.length ?? 0);
  console.log('Full upstream JSON (api.rainviewer.com/public/weather-maps.json):', upstream ?? null);

  if (upstream && typeof upstream === 'object') {
    const rootKeys = Object.keys(upstream as object);
    console.log('Upstream root keys:', rootKeys);

    const radarsFound = findRadarsLists(upstream);
    if (radarsFound.length === 0) {
      console.info(
        'No `radars` property in this upstream response — RainViewer at this endpoint typically only sends `version`, `generated`, `host`, `radar.past`, `radar.nowcast`, `satellite`, with no list of active stations.',
      );
    } else {
      console.log('`radars` found at path(s):', radarsFound.map(r => r.path));
      radarsFound.forEach(({ path, value }) => {
        console.log(`  → ${path}:`, value);
      });
    }

    console.log('Keys with "radar" in the name (nested):', collectRadarRelatedKeys(upstream));
  } else {
    console.warn(
      feedSource === 'practice_file'
        ? 'No upstream in this payload — expected with practice file; unset NEXT_PUBLIC_RADAR_PRACTICE or ensure the live API succeeds for full metadata.'
        : 'No upstream in this response (HTTP or network error; see error flag above).',
    );
  }

  const hay = JSON.stringify(upstream ?? {});
  const phMatch = hay.match(/\b(PHU|PHK|PKT)\b/i);
  const srtMatch = hay.match(/\bSRT\b/i);
  const stMatch = hay.match(/\b(SPT|SKA|STP)\b/i);
  const absentBecauseSchema =
    upstream && typeof upstream === 'object'
      ? ' — expected for composite API (station codes are not always strings in weather-maps.json; see ingest + Thailand index)'
      : '';
  console.log(
    'Phuket-style code in upstream JSON (PHU / PHK / PKT):',
    phMatch ? `found: ${phMatch[0]}` : `— (not as string in this JSON)${absentBecauseSchema}`,
  );
  console.log(
    'Surat Thani–style code in upstream (SRT):',
    srtMatch ? `found: ${srtMatch[0]}` : `— (not as string in this JSON)${absentBecauseSchema}`,
  );
  console.log(
    'Sathing Phra–style code in upstream (SPT / SKA / STP):',
    stMatch ? `found: ${stMatch[0]}` : `— (not as string in this JSON)${absentBecauseSchema}`,
  );

  console.groupEnd();
}
