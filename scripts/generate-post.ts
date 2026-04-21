#!/usr/bin/env npx tsx
/**
 * Sammi Post Generator — CLI
 *
 * Fetches live SPIRE data, generates a Reddit post in Sammi's voice,
 * and saves it as a DRAFT in Supabase (is_data_optimized = false).
 *
 * Usage:
 *   npx tsx scripts/generate-post.ts
 *   npm run generate-post
 *
 * Review drafts at:
 *   https://supabase.com/dashboard/project/tftkciljzqbiozqfdziv/editor
 *   SELECT * FROM draft_posts ORDER BY created_at DESC;
 */

import { config } from 'dotenv';
import { resolve }  from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { getSamuiForecastMerged } from '../lib/spire';
import { generateSammiRedditPost, saveDraftPost, IS_DATA_OPTIMIZED, type Webcam } from '../lib/sammi-post-generator';
import { createClient } from '@supabase/supabase-js';
import { spireFreshness, ageLabel } from '../lib/data-freshness';

/** Optional --cam "partial name" arg to pin a specific webcam for testing */
function getCamFilter(): string | null {
  const idx = process.argv.indexOf('--cam');
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

async function fetchWebcamOverride(filter: string): Promise<Webcam[]> {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await db
    .from('public_webcams')
    .select('id, name, region, url, description')
    .ilike('name', `%${filter}%`)
    .eq('is_active', true);
  if (error) throw new Error(`webcam fetch: ${error.message}`);
  return (data ?? []) as Webcam[];
}

async function main() {
  console.log('🏝️  Sammi Post Generator\n');
  console.log(`📋  IS_DATA_OPTIMIZED = ${IS_DATA_OPTIMIZED} (draft mode — no auto-posting)\n`);

  // 1. Fetch SPIRE forecast
  console.log('📡  Fetching SPIRE satellite data…');
  const rows = await getSamuiForecastMerged();
  if (rows.length === 0) {
    console.error('❌  No SPIRE data available. Check SPIRE_API_TOKEN.');
    process.exit(1);
  }
  console.log(`    ✓ ${rows.length} forecast hours loaded`);
  const spireFresh = spireFreshness(rows[0].time);
  console.log(`    Now: ${rows[0].temp.toFixed(1)}°C · ${rows[0].windSpeed.toFixed(1)} m/s · ${rows[0].precipRate.toFixed(2)} mm/h`);
  console.log(`    Satellite sync: ${spireFresh.syncTimeIct} ICT (${spireFresh.label})${spireFresh.isStale ? ' ⚠️  STALE' : ' ✓'}`);

  // Phase 2 — mainland rain radar (derived from SPIRE precip rate)
  const precipRate = rows[0].precipRate;
  const radarStatus = precipRate === 0 ? 'clear' : precipRate < 0.5 ? 'light_rain' : precipRate < 2.5 ? 'rain' : 'storm';
  console.log(`    Mainland rain radar: ${radarStatus.toUpperCase()} · ~live (10 min refresh)\n`);

  // Phase 3 — airport sensors
  console.log('🛫  Fetching airport sensors (VTSM)…');
  const { TH_SOUTH_METAR_URL, TH_SOUTH_AIRPORT_VOICE, parseMetar, pickRawMetarForIcao } =
    await import('../lib/metar');
  try {
    const metarRes = await fetch(TH_SOUTH_METAR_URL);
    if (metarRes.ok) {
      const raw = (await metarRes.json()) as import('../lib/metar').RawMetar[];
      const row = pickRawMetarForIcao(raw, 'VTSM');
      if (row) {
        const m = parseMetar(row, { airportLabel: TH_SOUTH_AIRPORT_VOICE.VTSM });
        const cloudDesc = m.clouds[0]
          ? `${m.clouds[0].cover}@${m.clouds[0].base ?? '?'}ft`
          : m.fltCat;
        const metarAge = Math.round((Date.now() / 1000 - m.obsTime) / 60);
        const staleFlag = metarAge > 45 ? ' ⚠️  STALE' : ' ✓';
        console.log(`    ✓ ${m.raw}`);
        console.log(`    Sky: ${cloudDesc} · Vis: ${m.visib} · ${m.fltCat}`);
        console.log(`    Airport sync: ${new Date(m.obsTime * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })} ICT (${metarAge}m ago)${staleFlag}\n`);
      }
    }
  } catch { console.log('    ⚠️  Airport sensors unavailable\n'); }

  // 2. Generate post
  const camFilter = getCamFilter();
  if (camFilter) {
    const pinned = await fetchWebcamOverride(camFilter);
    if (pinned.length === 0) {
      console.warn(`⚠️   No webcam matched "${camFilter}" — proceeding without cam override`);
    } else {
      console.log(`📌  Webcam pinned: ${pinned[0].name}\n`);
      // Inject the override via env so fetchWebcams() inside the generator reads it
      process.env.__WEBCAM_OVERRIDE__ = JSON.stringify(pinned);
    }
  }
  console.log('✍️   Generating post with Claude Sonnet…');
  const post = await generateSammiRedditPost(rows);
  console.log('\n─────────────────────────────────────────');
  console.log(`CONFLICT: ${post.conflictScenario.toUpperCase()} (confidence: ${post.conflictConfidence})`);
  console.log(`TITLE: ${post.title}`);
  console.log(`─────────────────────────────────────────`);
  console.log(post.body);
  console.log('─────────────────────────────────────────\n');

  // 3. Save to Supabase
  if (post.webcamName) {
    console.log(`📹  Webcam selected: ${post.webcamName}`);
    console.log(`    ${post.webcamUrl}\n`);
  } else {
    console.log('📹  No webcam selected (table may be empty)\n');
  }

  // 3. Save to Supabase
  console.log('💾  Saving draft to Supabase…');
  const id = await saveDraftPost(post);
  console.log(`    ✓ Draft saved — id: ${id}`);
  console.log(`    Radar: ${post.radarStatus} · Conflict: ${post.conflictScenario} (${post.conflictConfidence})`);  
  console.log('\n✅  Done! Review your draft at:');
  console.log('    https://supabase.com/dashboard/project/tftkciljzqbiozqfdziv/editor');
  console.log('    SELECT * FROM draft_posts ORDER BY created_at DESC LIMIT 1;');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
