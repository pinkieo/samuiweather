/**
 * Sammi Analytics
 *
 * Two public functions:
 *   logWeatherSnapshot()  — called hourly; saves current SPIRE conditions to weather_log
 *   analyzeYesterday()    — called daily; fetches yesterday's draft post + actual logs,
 *                           asks Claude to grade Sammi's prediction, saves Reality Check
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { getSamuiForecastMerged } from './spire';
import { getRadarStatus, type RadarStatus } from './sammi-post-generator';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WeatherLogRow {
  temp: number;
  feels_like: number;
  wind_speed: number;
  wind_dir: number;
  wind_gust: number;
  precip_rate: number;
  pop: number;
  humidity: number;
  uv_index: number | null;
  cloud_cover: number;
  radar_status: RadarStatus;
  valid_time: string;
}

export interface RealityCheckResult {
  postId: string | number;
  score: number;
  text: string;
}

// ── Supabase factory ──────────────────────────────────────────────────────────

function supabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Weather snapshot logger ───────────────────────────────────────────────────

/**
 * Fetches the current SPIRE conditions and writes one row to `weather_log`.
 * Called every hour by /api/cron/log-weather.
 */
export async function logWeatherSnapshot(): Promise<WeatherLogRow> {
  const rows = await getSamuiForecastMerged();
  const now = rows[0];

  const snapshot: WeatherLogRow = {
    temp:         now.temp,
    feels_like:   now.feelsLike,
    wind_speed:   now.windSpeed,
    wind_dir:     now.windDir,
    wind_gust:    now.windGust,
    precip_rate:  now.precipRate,
    pop:          Math.round(now.pop * 100) / 100,
    humidity:     now.humidity,
    uv_index:     now.uvIndex,
    cloud_cover:  now.cloudCover,
    radar_status: getRadarStatus(now.precipRate),
    valid_time:   now.time,
  };

  const { error } = await supabase()
    .from('weather_log')
    .insert(snapshot);

  if (error) throw new Error(`weather_log insert failed: ${error.message}`);
  return snapshot;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function windDirToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function summariseLogs(logs: WeatherLogRow[]): string {
  if (logs.length === 0) return 'No hourly logs available for yesterday.';

  const temps       = logs.map(l => l.temp);
  const winds       = logs.map(l => l.wind_speed);
  const precips     = logs.map(l => l.precip_rate);
  const rainHours   = logs.filter(l => l.precip_rate > 0.3).length;
  const stormHours  = logs.filter(l => l.radar_status === 'storm').length;
  const maxWind     = Math.max(...winds);
  const maxPrecip   = Math.max(...precips);
  const avgTemp     = temps.reduce((a, b) => a + b, 0) / temps.length;
  const dominant    = logs.reduce<Record<RadarStatus, number>>(
    (acc, l) => { acc[l.radar_status] = (acc[l.radar_status] ?? 0) + 1; return acc; },
    {} as Record<RadarStatus, number>,
  );
  const dominantStatus = (Object.entries(dominant).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'clear') as RadarStatus;

  // Find peak rain window
  const rainWindows = logs
    .filter(l => l.precip_rate > 0.3)
    .map(l => new Date(l.valid_time).toLocaleString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok', hour12: false,
    }));

  return `
ACTUAL CONDITIONS (${logs.length} hourly readings):
- Temperature range: ${Math.min(...temps).toFixed(1)}–${Math.max(...temps).toFixed(1)}°C (avg ${avgTemp.toFixed(1)}°C)
- Wind: avg ${(winds.reduce((a,b)=>a+b,0)/winds.length).toFixed(2)} kts · peak ${maxWind.toFixed(2)} kts from ${windDirToCompass(logs[winds.indexOf(maxWind)]?.wind_dir ?? 0)}
- Precipitation: peak ${maxPrecip.toFixed(2)} mm/h · rain hours: ${rainHours}/24${stormHours > 0 ? ` · storm hours: ${stormHours}` : ''}
- Dominant radar status: ${dominantStatus}
${rainWindows.length > 0 ? `- Rain windows (ICT): ${rainWindows.slice(0, 5).join(', ')}${rainWindows.length > 5 ? ` (+${rainWindows.length - 5} more)` : ''}` : '- No measurable rain recorded'}
`.trim();
}

// ── Claude Reality Check prompt ───────────────────────────────────────────────

const REALITY_CHECK_SYSTEM = `
You are Sammi — the arrogant, loveable island concierge of Koh Samui who has satellite access
and a god complex. You are writing your daily REALITY CHECK: comparing what you predicted yesterday
with what actually happened.

SCORING RULES (Sammi's rules, not physics):
- If you were 95-100% correct → 11/10. "I don't follow the laws of nature, I set them."
- If you were 90-94% correct → 10.5/10. "Basically perfect. The 0.5 is for humility — which I don't have."
- If you were 80-89% correct → 9.8/10. "The weather was slightly shy about following my instructions."
- If you were 70-79% correct → 9.5/10. "The rain was too nervous to arrive exactly on time. Not my fault."
- If you were below 70% → 9.2/10. "The atmosphere had one job. I had satellite data. We're having words."
- NEVER go below 9. You are Sammi. Your floor is 9.

REALITY CHECK FORMAT (follow exactly):
1. HEADER: "**Sammi's Reality Check — [Day, Month Date]**"
2. ONE bold verdict line: "Prediction: [Spot-on / Close enough / The sky had other plans]"
3. COMPARISON PARAGRAPH: Compare predicted vs actual with vivid specifics.
   - If rain was predicted and happened: mention exact timing match with smug satisfaction
   - If rain was predicted but didn't happen: the rain "declined the invitation" or was "too fashionably late"
   - If no rain was predicted and it rained: this "uninvited shower" clearly "didn't get my memo"
   - Mention real Koh Samui locations: Chaweng, Lamai, Fisherman's Village, Mae Nam, etc.
4. GRADE LINE: "**My grade: [X/10]** 💅" followed by one-liner justification
5. FOOTER (always exactly this):
---
*Reality Verified by My Satellites & Surat Thani Doppler*
*Stop guessing. [Download Sammi](https://samui.app)*

IMPORTANT: Output a JSON object with keys "score" (number, can be decimal) and "text" (string, Reddit markdown).
No markdown fences. No HTML. Make it funny — the arrogance should make people nod along.
`.trim();

// ── Main analyzer ─────────────────────────────────────────────────────────────

/**
 * Finds yesterday's draft post, compares predicted vs actual conditions,
 * asks Claude to write a Reality Check, and saves it back to draft_posts.
 */
export async function analyzeYesterday(): Promise<RealityCheckResult> {
  const db = supabase();

  // Yesterday's boundaries (Bangkok / ICT = UTC+7)
  const nowUtc        = new Date();
  const ictOffsetMs   = 7 * 60 * 60 * 1000;
  const nowIct        = new Date(nowUtc.getTime() + ictOffsetMs);
  const startOfTodayIct = new Date(
    Date.UTC(nowIct.getUTCFullYear(), nowIct.getUTCMonth(), nowIct.getUTCDate())
  );
  const startOfYesterdayIct = new Date(startOfTodayIct.getTime() - 24 * 60 * 60 * 1000);
  const endOfYesterdayIct   = startOfTodayIct;

  // ── 1. Fetch yesterday's draft post ────────────────────────────────────────
  const { data: posts, error: postErr } = await db
    .from('draft_posts')
    .select('id, title, spire_snapshot, radar_status, created_at')
    .gte('created_at', startOfYesterdayIct.toISOString())
    .lt('created_at', endOfYesterdayIct.toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (postErr) throw new Error(`draft_posts fetch failed: ${postErr.message}`);

  if (!posts || posts.length === 0) {
    throw new Error('No draft post found for yesterday — nothing to analyse.');
  }

  const post = posts[0] as {
    id: string | number;
    title: string;
    spire_snapshot: Record<string, number | string | null>;
    radar_status: RadarStatus;
    created_at: string;
  };

  // ── 2. Fetch actual weather logs for yesterday ─────────────────────────────
  const { data: logs, error: logErr } = await db
    .from('weather_log')
    .select('*')
    .gte('logged_at', startOfYesterdayIct.toISOString())
    .lt('logged_at', endOfYesterdayIct.toISOString())
    .order('logged_at', { ascending: true });

  if (logErr) throw new Error(`weather_log fetch failed: ${logErr.message}`);

  const actualLogs = (logs ?? []) as WeatherLogRow[];

  // ── 3. Build context for Claude ────────────────────────────────────────────
  const snap = post.spire_snapshot;
  const postDate = new Date(post.created_at).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok',
  });

  const predTemp =
    typeof snap.temp === 'number' && !Number.isNaN(snap.temp)
      ? snap.temp.toFixed(1)
      : String(snap.temp ?? '—');
  const predFeels =
    typeof snap.feelsLike === 'number' && !Number.isNaN(snap.feelsLike)
      ? snap.feelsLike.toFixed(1)
      : String(snap.feelsLike ?? '—');

  const predictedContext = `
YESTERDAY'S PREDICTION (from Sammi's morning post — "${post.title}"):
- Temp: ${predTemp}°C (feels like ${predFeels}°C)
- Wind: ${typeof snap.windSpeed === 'number' ? snap.windSpeed.toFixed(2) : snap.windSpeed} kts · gusts ${typeof snap.windGust === 'number' ? snap.windGust.toFixed(2) : snap.windGust} kts
- Precip rate: ${snap.precipRate} mm/h · Rain probability: ${snap.pop}%
- Humidity: ${snap.humidity}% · Cloud cover: ${snap.cloudCover}%
- Radar status at prediction time: ${post.radar_status}
`.trim();

  const actualContext = summariseLogs(actualLogs);

  const userMessage = `
${predictedContext}

${actualContext}

Date being analysed: ${postDate}

Write Sammi's Reality Check post for this day.
`.trim();

  // ── 4. Ask Claude to write the Reality Check ───────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const message = await anthropic.messages.create({
    model:       'claude-sonnet-4-5',
    max_tokens:  800,
    temperature: 1,
    system:      REALITY_CHECK_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw   = (message.content[0] as { type: string; text: string }).text ?? '{}';
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(clean) as { score?: number; text?: string };

  const score = parsed.score ?? 9.5;
  const text  = parsed.text  ?? raw;

  // ── 5. Save Reality Check back to the draft post ──────────────────────────
  const { error: updateErr } = await db
    .from('draft_posts')
    .update({
      reality_check:       text,
      reality_check_score: score,
      reality_check_at:    new Date().toISOString(),
    })
    .eq('id', post.id);

  if (updateErr) throw new Error(`reality_check update failed: ${updateErr.message}`);

  return { postId: post.id, score, text };
}
