/**
 * Browser console helper — logs RainViewer `/api/radar/frames` payload (upstream + now frame).
 * Publieke `weather-maps.json` heeft meestal géén `radars[]` met PHU/SRT/SKA; dat tonen we expliciet.
 */

import type { RainViewerIngestProof } from './rainviewer-ingest-proof';

export type RadarFramesApiResponse = {
  frames?: { path: string; time: number }[];
  /** RainViewer `radar.nowcast` — short extrapolated radar loop (future frames). */
  nowcastFrames?: { path: string; time: number }[];
  nowFrame?: { path: string; time: number } | null;
  /** Volledige snapshot van `https://api.rainviewer.com/public/weather-maps.json` */
  upstream?: unknown;
  error?: string;
  /** Audit: PHU / SRT / SKA vs composite path (no per-station IDs inside JSON). */
  ingest?: RainViewerIngestProof;
  /** Alleen client: waar deze payload vandaan komt (snapshot heeft geen `upstream`). */
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

/** Zoek geneste `radars` properties (elke vorm). */
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
      'Bron: lokaal snapshot-bestand (NEXT_PUBLIC_RADAR_PRACTICE fallback) — geen `upstream` veld; audit gebruikt vaste ingest-tekst.',
    );
  } else if (feedSource === 'api') {
    console.info('Bron: live GET /api/radar/frames → https://api.rainviewer.com/public/weather-maps.json');
  }

  if (error) {
    console.warn('/api/radar/frames error flag:', error);
  }
  console.log("Active / 'now' frame (nieuwste scan in onze venster-array):", nowFrame ?? null);
  console.log('Frames in response (count):', frames?.length ?? 0);
  console.log('Full upstream JSON (api.rainviewer.com/public/weather-maps.json):', upstream ?? null);

  if (upstream && typeof upstream === 'object') {
    const rootKeys = Object.keys(upstream as object);
    console.log('Upstream root keys:', rootKeys);

    const radarsFound = findRadarsLists(upstream);
    if (radarsFound.length === 0) {
      console.info(
        'Geen property `radars` in deze upstream response — RainViewer stuurt op dit endpoint typisch alleen `version`, `generated`, `host`, `radar.past`, `radar.nowcast`, `satellite`, zonder lijst van actieve stations.',
      );
    } else {
      console.log('`radars` gevonden op pad(en):', radarsFound.map(r => r.path));
      radarsFound.forEach(({ path, value }) => {
        console.log(`  → ${path}:`, value);
      });
    }

    console.log('Keys met "radar" in de naam (genest):', collectRadarRelatedKeys(upstream));
  } else {
    console.warn(
      feedSource === 'practice_file'
        ? 'Geen upstream in deze payload — verwacht bij practice-bestand; zet NEXT_PUBLIC_RADAR_PRACTICE uit of zorg dat live API slaagt voor volledige metadata.'
        : 'Geen upstream in dit antwoord (HTTP-fout of netwerk; zie error flag hierboven).',
    );
  }

  const hay = JSON.stringify(upstream ?? {});
  const phMatch = hay.match(/\b(PHU|PHK|PKT)\b/i);
  const srtMatch = hay.match(/\bSRT\b/i);
  const stMatch = hay.match(/\b(SPT|SKA|STP)\b/i);
  const absentBecauseSchema =
    upstream && typeof upstream === 'object'
      ? ' — verwacht bij composite-API (stationcodes staan niet als strings in weather-maps.json; zie ingest + Thailand-index)'
      : '';
  console.log(
    'Phuket-achtige code in upstream-JSON (PHU / PHK / PKT):',
    phMatch ? `gevonden: ${phMatch[0]}` : `— (niet als string in deze JSON)${absentBecauseSchema}`,
  );
  console.log(
    'Surat Thani-achtige code in upstream (SRT):',
    srtMatch ? `gevonden: ${srtMatch[0]}` : `— (niet als string in deze JSON)${absentBecauseSchema}`,
  );
  console.log(
    'Sathing Phra-achtige code in upstream (SPT / SKA / STP):',
    stMatch ? `gevonden: ${stMatch[0]}` : `— (niet als string in deze JSON)${absentBecauseSchema}`,
  );

  console.groupEnd();
}
