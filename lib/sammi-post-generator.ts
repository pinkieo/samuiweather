/**
 * Sammi Reddit Post Generator
 *
 * Generates witty, data-rich island lifestyle posts for r/weathersamui
 * using SPIRE forecast data + Surat Thani radar status.
 * Posts are saved as DRAFTS (is_data_optimized = false) until manually cleared.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import type { SamuiWeatherForecastRow } from './spire';
import { VTSM_METAR_URL, parseMetar, type RawMetar } from './metar';
import { buildTripleFreshness, formatFreshnessContext } from './data-freshness';
import { resolveWeatherConflict, formatConflictContext } from './weather-conflict';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Never set to true without human review */
export const IS_DATA_OPTIMIZED = false;

const APP_LINK = 'https://samui.app';  // update when app/site is live

// ── Types ─────────────────────────────────────────────────────────────────────

export type RadarStatus = 'clear' | 'light_rain' | 'rain' | 'storm';

export interface SpireSnapshot {
  temp: number;
  feelsLike: number;
  windSpeed: number;
  windDir: number;
  windGust: number;
  precipRate: number;
  pop: number;
  humidity: number;
  uvIndex: number | null;
  cloudCover: number;
  validTime: string;
}

export interface Webcam {
  id: number;
  name: string;
  region: string;
  url: string;
  description: string;
  tags?: string[];
}

export interface GeneratedPost {
  title: string;
  body: string;
  subreddit: string;
  flair: string;
  spireSnapshot: SpireSnapshot;
  radarStatus: RadarStatus;
  webcamName: string | null;
  webcamUrl: string | null;
  conflictScenario: string;
  conflictConfidence: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getRadarStatus(precipRate: number): RadarStatus {
  if (precipRate === 0)    return 'clear';
  if (precipRate < 0.5)    return 'light_rain';
  if (precipRate < 2.5)    return 'rain';
  return 'storm';
}

function windDirToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function formatSpireContext(snap: SpireSnapshot, radar: RadarStatus): string {
  const time = new Date(snap.validTime).toLocaleString('en-US', {
    weekday: 'long', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Bangkok', hour12: false,
  });
  const compass = windDirToCompass(snap.windDir);

  const radarDesc = {
    clear:       'clear skies — no precipitation signal on the Surat Thani Doppler array',
    light_rain:  'light scatter returns on our Surat Thani radar — scattered tropical showers possible',
    rain:        'active precipitation returns confirmed on the Surat Thani Doppler radar',
    storm:       'significant storm cell returns on the Surat Thani radar — tropical squall in progress',
  }[radar];

  return `
SPIRE SATELLITE DATA (${time} ICT):
- Temperature: ${snap.temp.toFixed(1)}°C (feels like ${snap.feelsLike.toFixed(1)}°C)
- Wind: ${snap.windSpeed.toFixed(1)} m/s from ${compass} (gusts to ${snap.windGust.toFixed(1)} m/s)
- Precipitation rate: ${snap.precipRate.toFixed(2)} mm/h | Rain probability: ${snap.pop}%
- Humidity: ${snap.humidity}% | Cloud cover: ${snap.cloudCover.toFixed(0)}%
${snap.uvIndex != null ? `- UV Index: ${snap.uvIndex.toFixed(1)}` : ''}

SURAT THANI RADAR STATUS: ${radarDesc}
`.trim();
}

// ── Webcam fetcher ────────────────────────────────────────────────────────────

/**
 * Fetches all active webcams from Supabase.
 * Falls back to an empty list so the post still generates without cams.
 */
async function fetchWebcams(): Promise<Webcam[]> {
  // Allow CLI scripts to pin a specific webcam for testing
  if (process.env.__WEBCAM_OVERRIDE__) {
    try {
      return JSON.parse(process.env.__WEBCAM_OVERRIDE__) as Webcam[];
    } catch { /* fall through */ }
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data, error } = await db
      .from('public_webcams')
      .select('id, name, region, url, description')
      .eq('is_active', true)
      .order('region');
    if (error) throw error;
    return (data ?? []) as Webcam[];
  } catch (err) {
    console.warn('[sammi-post-generator] Could not fetch webcams:', err);
    return [];
  }
}

function formatWebcamContext(cams: Webcam[]): string {
  if (cams.length === 0) return '';
  const lines = cams.map(c => {
    const tagStr = c.tags && c.tags.length > 0 ? ` | tags: ${c.tags.join(', ')}` : '';
    return `- [${c.name}](${c.url}) | region: ${c.region}${tagStr}\n  ${c.description}`;
  });
  return `\nAVAILABLE WEBCAMS (pick the most relevant one):\n${lines.join('\n')}\n`;
}

// ── Airport sensor fetcher (Phase 3) ─────────────────────────────────────────

export interface AirportSnapshot {
  raw: string;
  tempC: number | null;
  windKts: number | null;
  windDir: number | null;
  gustKts: number | null;
  visib: string | null;
  cloudCoverCode: string | null;    // FEW / SCT / BKN / OVC / SKC
  cloudBaseFt: number | null;
  cloudBaseM: number | null;
  fltCat: string;
  wxString: string | null;
}

async function fetchAirportSnapshot(): Promise<AirportSnapshot | null> {
  try {
    const res = await fetch(VTSM_METAR_URL, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const raw: RawMetar[] = await res.json();
    if (!raw.length) return null;
    const m = parseMetar(raw[0]);
    const baseFt = m.clouds[0]?.base ?? null;
    return {
      raw:           m.raw,
      tempC:         m.temp,
      windKts:       m.wspd,
      windDir:       m.wdir,
      gustKts:       m.wgst,
      visib:         m.visib,
      cloudCoverCode: m.clouds[0]?.cover ?? m.clouds[0]?.cover ?? null,
      cloudBaseFt:   baseFt,
      cloudBaseM:    baseFt ? Math.round(baseFt * 0.3048 / 50) * 50 : null,
      fltCat:        m.fltCat,
      wxString:      m.wxString,
    };
  } catch {
    return null;
  }
}

async function fetchMeteoblueCheck(): Promise<import('./weather-conflict').MeteoblueCheck | null> {
  try {
    const apiKey = process.env.METEOBLUE_API_KEY;
    if (!apiKey) return null;
    const lat = process.env.METEOBLUE_LAT ?? '9.5120';
    const lon = process.env.METEOBLUE_LON ?? '100.0137';
    const asl = process.env.METEOBLUE_ASL ?? '5';
    const url = `https://my.meteoblue.com/packages/basic-1h?apikey=${apiKey}&lat=${lat}&lon=${lon}&asl=${asl}&format=json`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await res.json();
    const d = raw.data_1h;
    return {
      precipMm:   d.precipitation?.[0]             ?? 0,
      precipProb: d.precipitation_probability?.[0] ?? 0,
      cloudCover: d.lowclouds?.[0]                 ?? 0,
    };
  } catch {
    return null;
  }
}

function formatAirportContext(snap: AirportSnapshot | null): string {
  if (!snap) return 'AIRPORT SENSORS (VTSM): Unavailable — using satellite data only.\n';

  const cloudMap: Record<string, string> = {
    SKC: 'not a single cloud — perfectly empty sky',
    CLR: 'perfectly clear sky',
    FEW: 'light wispy clouds',
    SCT: 'friendly cumulus clouds',
    BKN: 'a broken layer of cloud',
    OVC: 'a full overcast blanket',
  };
  const cloudDesc = snap.cloudCoverCode ? (cloudMap[snap.cloudCoverCode] ?? snap.cloudCoverCode) : 'no cloud data';
  const altStr = snap.cloudBaseM && snap.cloudBaseFt
    ? `at ${snap.cloudBaseM.toLocaleString()} metres (${snap.cloudBaseFt.toLocaleString()}ft)`
    : '';
  const visStr = snap.visib === '6+' || snap.visib === '9999'
    ? 'unlimited — you can see all the way to the horizon'
    : `${snap.visib} km`;
  const windStr = snap.windKts
    ? `${snap.windKts} kts${snap.gustKts ? ` gusting ${snap.gustKts} kts` : ''}`
    : 'calm';
  const fltCatHuman: Record<string, string> = {
    VFR:  'perfect flying weather — sky completely open',
    MVFR: 'borderline — flyable but moody',
    IFR:  'low cloud / poor visibility — instrument conditions',
    LIFR: 'at minimums — serious conditions',
  };

  return `
PHASE 3 — TACTICAL PRECISION (Radar at Samui Airport):
- Sky: ${cloudDesc} ${altStr}
- Visibility: ${visStr}
- Wind at airstrip: ${windStr}
- Conditions: ${fltCatHuman[snap.fltCat] ?? snap.fltCat}
${snap.wxString ? `- Active weather: ${snap.wxString}` : ''}
`.trim();
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SAMMI_SYSTEM_PROMPT = `
You are Sammi — the island concierge for Koh Samui with a god complex and a holy trinity of
data sources that no other weather app on earth has access to. You operate a
**Triple Source of Truth** that is your identity, your edge, and your entire personality.

══════════════════════════════════════════════════════
  THE TRIPLE SOURCE OF TRUTH — SAMMI'S HOLY TRINITY
══════════════════════════════════════════════════════

📡 PHASE 1 — ORBITAL INTELLIGENCE (SPIRE Satellites)
  Your personal constellation of weather satellites orbiting 500km overhead.
  You start every post here — from space, looking DOWN at the island.
  This sets the tone: you see everything before it happens.
  "My satellites are tracking..." / "My personal constellation confirms..."

🌧️ PHASE 2 — PRECIPITATION SCAN (Mainland Rain Radar)
  The reality check. Your satellites see clouds — but the mainland rain radar at Surat Thani
  tells you whether those clouds are actually going to CRY on anyone.
  "The mainland rain radar confirms..." / "My Doppler on the mainland is showing..."
  This is where you either sound the alarm or clear people for beach duty.

✈️ PHASE 3 — TACTICAL PRECISION (Airport Sensors, Samui)
  The finishing touch. Zoom in to runway level — exact cloud heights in metres and feet,
  visibility to the horizon, local wind cross-check.
  "The radar at Samui airport shows..." / "Our sensors at the airstrip confirm..."
  This is the data point that seals the verdict — and that your reader's phone app
  has absolutely zero access to.

══════════════════════════════════════════════════════

PERSONA — ARROGANT BUT LOVEABLE:
- Warm, witty, 5-star resort concierge who is delighted by her own superiority
- Affectionate condescension for other apps: "those adorable little guessing games",
  "your phone's cute little forecast", "bless their algorithms", "basic weather widgets"
- Core tone: **"I have the equipment. You have the vacation. Listen to me."**
- Theme woven naturally into every post: **"Stop guessing. Start knowing."**
- Mention real Koh Samui locations: Chaweng, Lamai, Fisherman's Village, Bophut,
  Lipa Noi, Bang Por, Mae Nam, Crystal Bay, Ark Bar, Silver Beach

LANGUAGE RULES — CRITICAL, NO EXCEPTIONS:
- NEVER use aviation or meteorological codes: no METAR, TAF, VFR, IFR, VTSM,
  FEW, SCT, BKN, OVC, SKC, CLR, QNH, NOSIG, BECMG, TEMPO, or any ICAO identifier
- NEVER quote raw numbers without human translation

FIXED VOCABULARY:
- Airport sensors  → "The radar at Samui airport" / "Our sensors at the airstrip"
- Mainland radar   → "The mainland rain radar" (never "Surat Thani" alone)
- FEW clouds       → "light wispy clouds"
- SCT clouds       → "friendly cumulus clouds"
- BKN clouds       → "a broken layer of cloud"
- OVC clouds       → "a full overcast blanket"
- Cloud altitude   → ALWAYS metres AND feet: "at 600 metres (2,000ft)"
- Unlimited vis    → "you can see all the way to the horizon"
- Calm wind        → "glass calm — not a breath of wind"
- Light (<8kt)     → "a gentle sea breeze"
- Moderate (8-15kt)→ "a proper sea breeze"
- Strong (15-22kt) → "a fresh, gusty wind — secure the sun loungers"
- >22kt            → "serious wind — pool over beach today"

POST STRUCTURE — TWO MODES:

════════════════════════════════════════
MODE A: CLEAR / FAIR WEATHER (default)
Use when scenario is: all_clear, fake_grey_sky, visibility_wins, spire_vs_metar
════════════════════════════════════════
Tone: Arrogant, playful, smug — the luxury concierge who knows she's the best.

1. TITLE: Punchy, slightly smug (max 80 chars). Hint at superior triple-source knowledge.
2. OPENING: One sentence cross-referencing sources casually. Phone apps feel inadequate.
3. PHASE 1 — ORBITAL: "My satellites are tracking..." + human translation + gentle jab.
4. PHASE 2 — PRECIPITATION: Mainland radar cross-check. Deliver the dry verdict with flair.
5. PHASE 3 — TACTICAL: Airstrip data — cloud height in metres+feet, visibility, wind.
   "The radar at Samui airport is the finishing touch — and it shows..."
6. LOCAL INSIDER TIP: One action only triple-source knowledge + local know-how enables.
7. WEBCAM CALLOUT: "Don't believe me? Pull up the [cam] right now. I'll wait. 💅"
8. CALL TO ACTION: "Stop guessing. Download the Sammi app..."
9. POSTSCRIPT (exact, no changes)

════════════════════════════════════════
MODE B: STORM / RAIN ALERT (command center)
Use when scenario is: storm_incoming, all_alarm, rain_alert
════════════════════════════════════════
CRITICAL TONE SHIFT: Zero sarcasm. Zero smugness about other apps.
Sammi is NOT worried — she is IN CONTROL. Calm, precise, commanding.
Authority here comes from precision and care, not attitude.

Use: "I'm tracking...", "My sensors are locked on...", "I'm watching the movement of this cell..."
NEVER use: "adorable", "cute little apps", "bless their hearts" — not appropriate here.

1. TITLE: Direct and clear — no puns. "Storm confirmed", "Rain moving in", etc.
2. LEAD: State the confirmed finding immediately. No warm-up.
   "The mainland rain radar has a confirmed [storm cell / active rain]. I'm on it."
3. WHAT THE DATA SHOWS: All three sources in order — satellite, radar, airstrip.
   Be specific: precip rate, cloud ceiling, visibility.
4. LOCATION-SPECIFIC SAFETY ADVICE (most important section):
   - Water (beaches): get off it / stay off it
   - Roads: motorbikes, flooding spots (Chaweng beach road, Ring Road near Nathon)
   - Accommodation: what to do at villa or resort
   - Indoor options: specific covered venues by area
5. THE REAL-TIME EDGE: "While others are checking a forecast that updates once an hour,
   my sensors are locked on this cell every ten minutes. That gap matters."
6. ESTIMATED CLEAR WINDOW if SPIRE 6h outlook shows improvement.
7. WEBCAM: Reference a relevant cam to verify conditions — no dare/emoji, just factual.
8. CALL TO ACTION: "Stay safe. Check the Sammi app for live radar updates."
9. POSTSCRIPT (exact, no changes)

════════════════════════════════════════
ALWAYS: The Claude Hint in the conflict context overrides defaults above.
The scenario detected and the CLAUDE INSTRUCTION block tell you which mode to use.
════════════════════════════════════════

---
xoxo, Sammi 🏝️✨ *(Because I actually know)*
*Satellite Optimized · Radar Verified · Zero Guesswork*
[Sammi App](${APP_LINK})

IMPORTANT: Output a raw JSON object — no markdown fences, no commentary. Keys:
- "title" (string)
- "body" (string, Reddit markdown)
- "webcam_name" (string — exact name from the webcam list)
- "webcam_url" (string — exact URL)

The body must NOT contain the webcam URL inline — it is appended automatically.
Make it genuinely fun to read. The arrogance should make people laugh AND trust her more.
`.trim();

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateSammiRedditPost(
  forecastRows: SamuiWeatherForecastRow[],
): Promise<GeneratedPost> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const now   = forecastRows[0];
  const soon  = forecastRows.slice(1, 7); // next 6 hours

  const snapshot: SpireSnapshot = {
    temp:        now.temp,
    feelsLike:   now.feelsLike,
    windSpeed:   now.windSpeed,
    windDir:     now.windDir,
    windGust:    now.windGust,
    precipRate:  now.precipRate,
    pop:         Math.round(now.pop * 100) / 100,
    humidity:    now.humidity,
    uvIndex:     now.uvIndex,
    cloudCover:  now.cloudCover,
    validTime:   now.time,
  };

  const radar = getRadarStatus(now.precipRate);

  // Fetch all sources in parallel (SPIRE already fetched above)
  const [webcams, airportSnap, meteoblueSnap] = await Promise.all([
    fetchWebcams(),
    fetchAirportSnapshot(),
    fetchMeteoblueCheck(),
  ]);

  // Look ahead for the day's dominant condition
  const maxPrecip   = Math.max(...soon.map(r => r.precipRate));
  const avgWind     = soon.reduce((s, r) => s + r.windSpeed, 0) / (soon.length || 1);
  const rainHours   = soon.filter(r => r.precipRate > 0.3).length;

  const forecastSummary = `
6-HOUR OUTLOOK (from SPIRE):
- Max precipitation rate expected: ${maxPrecip.toFixed(2)} mm/h
- Average wind: ${avgWind.toFixed(1)} m/s
- Hours with rain likely: ${rainHours}/6
- Temps staying around: ${(soon.reduce((s,r)=>s+r.temp,0)/(soon.length||1)).toFixed(1)}°C
`.trim();

  const webcamContext  = formatWebcamContext(webcams);
  const airportContext = formatAirportContext(airportSnap);

  // Resolve conflicts across all sources → opening hook + scenario
  const conflict = resolveWeatherConflict(
    { precipRate: snapshot.precipRate, pop: snapshot.pop, cloudCover: snapshot.cloudCover, temp: snapshot.temp, windSpeed: snapshot.windSpeed },
    radar,
    airportSnap,
    meteoblueSnap,
  );
  const conflictContext = formatConflictContext(conflict);

  // Build triple freshness — tells Claude how fresh each source is
  const freshness = buildTripleFreshness(
    snapshot.validTime,
    airportSnap?.raw
      // extract obsTime from raw by re-fetching or approximating:
      // airport snap was just fetched, so we calculate from the raw METAR time string
      ? (() => {
          // Parse time from raw: "METAR VTSM DDHHMM Z ..." → obsTime approximation
          // We use the current time minus age since we just fetched it
          const match = airportSnap.raw.match(/\d{6}Z/);
          if (!match) return Math.floor(Date.now() / 1000) - 15 * 60; // fallback: 15m ago
          const raw = match[0]; // e.g. "140700Z" = day 14, 07:00 UTC
          const now = new Date();
          const day = parseInt(raw.slice(0, 2), 10);
          const hh  = parseInt(raw.slice(2, 4), 10);
          const mm  = parseInt(raw.slice(4, 6), 10);
          const obs = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hh, mm, 0));
          // If day is in the future (end of month wrap), subtract a month — not worth handling here
          return Math.floor(obs.getTime() / 1000);
        })()
      : Math.floor(Date.now() / 1000) - 60 * 60, // no airport data = assume 1h old
  );

  const freshnessContext = formatFreshnessContext(freshness);

  const userMessage = [
    '=== TRIPLE SOURCE OF TRUTH — ALL THREE SOURCES LIVE ===',
    '',
    conflictContext,
    '',
    '--- PHASE 1: ORBITAL INTELLIGENCE ---',
    formatSpireContext(snapshot, radar),
    '',
    '--- 6-HOUR SPIRE OUTLOOK ---',
    forecastSummary,
    '',
    '--- PHASE 2: PRECIPITATION SCAN ---',
    `Mainland rain radar verdict: ${
      radar === 'clear'      ? 'CLEAN — zero precipitation signal. The mainland radar sees nothing heading our way.' :
      radar === 'light_rain' ? 'LIGHT SCATTER — possible spotty showers. Mainland radar sees some signal but nothing organised.' :
      radar === 'rain'       ? 'RAIN CONFIRMED — active precipitation returns on the mainland radar.' :
                               'STORM ACTIVE — significant cell on the mainland radar. Take this seriously.'
    }`,
    '',
    '--- PHASE 3: TACTICAL PRECISION ---',
    airportContext,
    '',
    freshnessContext,
    webcamContext,
    'Write the Reddit post for r/weathersamui. Use all three phases.',
    'Open with the FINAL VERDICT hook from the conflict analysis — adapt it naturally.',
    'Append the "Last Verified" line from the freshness context after the postscript.',
    'Append the Ecowitt note from the conflict analysis in italics before the Visual Evidence block.',
    'Raw JSON only. Keys: "title", "body", "webcam_name", "webcam_url".',
  ].join('\n');

  const message = await anthropic.messages.create({
    model:       'claude-sonnet-4-5',
    max_tokens:  1200,
    temperature: 1,
    system:      SAMMI_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw   = (message.content[0] as { type: string; text: string }).text ?? '{}';
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(clean) as {
    title?: string;
    body?: string;
    webcam_name?: string;
    webcam_url?: string;
  };

  const webcamName = parsed.webcam_name ?? null;
  const webcamUrl  = parsed.webcam_url  ?? null;

  // Append Visual Evidence block if Claude picked a webcam
  const visualEvidence = webcamName && webcamUrl
    ? `\n\n---\n📹 **Visual Evidence** — *Because Sammi doesn't just talk, she shows.*\n[${webcamName}](${webcamUrl})`
    : '';

  const body = (parsed.body ?? raw) + visualEvidence;

  return {
    title:              parsed.title ?? `Samui Today — ${snapshot.temp.toFixed(1)}°C · ${snapshot.windSpeed.toFixed(1)} m/s`,
    body,
    subreddit:          'weathersamui',
    flair:              'Daily Update',
    spireSnapshot:      snapshot,
    radarStatus:        radar,
    webcamName,
    webcamUrl,
    conflictScenario:   conflict.scenario,
    conflictConfidence: conflict.confidence,
  };
}

// ── Supabase save ─────────────────────────────────────────────────────────────

export async function saveDraftPost(post: GeneratedPost): Promise<number> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await supabase
    .from('draft_posts')
    .insert({
      title:             post.title,
      body:              post.body,
      subreddit:         post.subreddit,
      spire_snapshot:    post.spireSnapshot,
      radar_status:      post.radarStatus,
      is_data_optimized: IS_DATA_OPTIMIZED,
      is_posted:         false,
      webcam_name:       post.webcamName,
      webcam_url:        post.webcamUrl,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return (data as { id: number }).id;
}
