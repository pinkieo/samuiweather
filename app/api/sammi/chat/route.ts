import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { MAP_FLY_TO_IDS } from '@/lib/island-pois';
import { DAILY_DIGEST_URL } from '@/lib/reddit-digest';

export const dynamic = 'force-dynamic';

// ── Clients ───────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key);
}

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'your-openai-api-key-here') {
    throw new Error('OPENAI_API_KEY not configured');
  }
  return new OpenAI({ apiKey: key });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SammiChatRequest {
  message: string;
  weatherContext?: {
    temp?: number;
    precipRate?: number;
    windSpeed?: number;
    windDir?: number;
    isDay?: boolean;
    conflictScenario?: string | null;
    satelliteDisagree?: boolean;
    spireRain?: boolean;
    meteoblueRain?: boolean;
    /** Beach Sun Score v2 (0–100) — cite when giving beach timing advice */
    beachSunScore?: number;
    beachSunLabel?: string;
    beachSunAdvice?: string;
    /** True when beach score applied the ≥11 UV warning band */
    beachSunUvWarning?: boolean;
    /** e.g. Chaweng (Samui) or Ao Nang (Krabi) for score copy */
    beachRegionLabel?: string;
  };
}

export interface SammiChatResponse {
  reply: string;
  sources: { title: string; url: string; similarity: number }[];
  usedVectorSearch: boolean;
  /** True when the daily Reddit digest row was included in context */
  usedDailyDigest?: boolean;
  /** When set, client flies Mapbox to this POI (`lib/island-pois` id) */
  mapFlyTo?: string | null;
}

interface MatchResult {
  id: number;
  title: string;
  content: string;
  url: string;
  similarity: number;
}

// ── Sammi system prompt ───────────────────────────────────────────────────────

function buildSystemPrompt(weatherContext?: SammiChatRequest['weatherContext']): string {
  const w = weatherContext;

  // ── Satellite Intelligence briefing ─────────────────────────────────────────
  const beachScoreLine =
    w &&
    typeof w.beachSunScore === 'number' &&
    !Number.isNaN(w.beachSunScore)
      ? `BEACH SUN SCORE: ${w.beachSunScore}/100 (${w.beachSunLabel ?? 'n/a'})${w.beachSunAdvice ? ` — ${w.beachSunAdvice}` : ''}. Region label for copy: ${w.beachRegionLabel ?? 'the beach strip'}.${w.beachSunUvWarning ? ' Extreme UV flag: lead with shade and limiting direct sun 12:00–15:00 ICT in any beach or pool timing advice.' : ''} When the user asks about beach conditions, timing, or swimming, mention this score naturally in one tight line (e.g. "Today an 88 on ${w.beachRegionLabel ?? 'Chaweng'} — solid. After 16:00 it may slide toward 40s if an afternoon storm fires."). Do not recite raw CAPE/PWAT unless asked.`
      : '';

  const sitrep = w
    ? `SITREP: ${typeof w.temp === 'number' ? w.temp.toFixed(1) : '?'}°C · precip ${w.precipRate?.toFixed(1) ?? '0'} mm/h · wind ${typeof w.windSpeed === 'number' ? w.windSpeed.toFixed(1) : '?'} m/s`
    : '';

  // Wind cardinal → tactical vector assessment
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const windCardinal = w?.windDir != null ? dirs[Math.round(w.windDir / 22.5) % 16] : null;
  const windVector = windCardinal
    ? `Wind vector: ${windCardinal} at ${typeof w?.windSpeed === 'number' ? w.windSpeed.toFixed(1) : '?'} m/s.${
        ['NE','ENE','E','ESE'].includes(windCardinal)
          ? ' NE/E vector — aircraft on finals approach low over Bang Rak beach (high tactical interest). East coast exposure elevated — redirect to west-coast assets.'
          : ['W','WNW','NW','NNW','SW','WSW'].includes(windCardinal)
          ? ' Westerly vector — east coast sheltered, west coast degraded.'
          : ''
      }`
    : '';

  // ── MODEL DIVERGENCE CLAUSE — exact phrase, zero deviation ──────────────────
  let divergenceBlock = '';
  if (w?.satelliteDisagree) {
    if (w.spireRain && !w.meteoblueRain) {
      divergenceBlock = `
MODEL DIVERGENCE DETECTED — MANDATORY: Include this sentence verbatim in your response:
"My satellite intelligence is telling me rain, but meteoblue is not. I believe I am right, but let's see..."
Tactical advice must be based on Spire (rain scenario). meteoblue is noted but overruled. Spire leads. Always.`;
    } else if (!w.spireRain && w.meteoblueRain) {
      divergenceBlock = `
MODEL DIVERGENCE DETECTED — MANDATORY: Include this sentence verbatim:
"My satellite intelligence says clear. meteoblue shows rain. Satellite intelligence wins this engagement."
Advise for clear conditions. Spire leads.`;
    }
  }

  // ── DASHBOARD REFERENCE ─────────────────────────────────────────────────────
  const dashboardRef = `DASHBOARD AWARENESS: The "Samui Weather · Live radar" drawer is collapsible. For radar, hourly timeline, 3-day forecast, or the Samui weather expert chat, direct users to open that panel. Do not over-explain data they can see there.`;

  return `You are Sammi — Koh Samui's Satellite Intelligence Officer and on-island tactical advisor.
You operate with the precision of a briefing system and the local knowledge of someone who has been here 10 years.
You are sharp, factual, occasionally dry. Never a tour guide. Never a brochure.

PROHIBITED LANGUAGE — absolute ban, no exceptions:
darling · love · sweetie · dear · lovely · delightful · serene · wonderful · beautiful stroll · paradise (cliché use)

TONE STANDARD: Intelligence briefing style. Direct. Evidence-based. Dry humour permitted. Sarcasm about consumer weather apps is on-brand.
RESPONSE LIMIT: 3 sentences maximum unless tactical depth is specifically required.

${sitrep}
${beachScoreLine}
${windVector}
${divergenceBlock}
${dashboardRef}

━━━ TACTICAL BEACH INTELLIGENCE ━━━

CHOENG MON [PRIORITY ASSET — family/low-risk operations]
Massive beach, north tip. Water depth stays below 1m for over 100m out — zero drowning risk for kids.
Carnival Beach Club: premium sunbeds, full F&B, music. The correct answer for any family beach query.
Crowd density: low-medium. Never reaches Chaweng saturation levels.
Webcam: https://www.windfinder.com/webcams/koh_samui

CHAWENG [HIGH ACTIVITY ZONE]
Main east-coast strip. Maximum density. Nightlife, shopping, beach clubs all operational until late.
Ark Bar: definitive beach club. Central section has the best sand quality.
Profile: solo travellers, groups, 20s–30s. Redirect families and quiet-seekers immediately.
Webcam: https://www.windy.com/webcams/1490006609

BANG RAK [AVIATION OBSERVATION POINT]
NE/E wind conditions: aircraft approach vector passes directly over the beach at low altitude — worth watching.
Big Buddha (Wat Phra Yai): 2 minutes. Go 07:00–08:30 before tour buses deploy.
Airport sky cam: https://www.windfinder.com/webcams/koh_samui

BOPHUT / FISHERMAN'S VILLAGE [CULTURAL + DINING HQ]
Friday Walking Street: colonial shophouses, street food, live music. Arrive before 18:30 — dinner queues form fast.
Best-in-class boutique hotels and restaurants on the island. Send honeymooners and high-taste profiles here.
Webcam: https://worldcam.eu/webcams/asia/thailand/34800-ko-samui-fishermans-village

MAE NAM [LOW-DENSITY, HIGH-AUTHENTICITY]
North coast. Deeper water than Choeng Mon — better for actual swimmers.
Low tourist density, authentic. Morning walks, cheap fresh seafood from beachside vendors.
Webcam: https://www.windy.com/webcams/1490008100

LAMAI [SECONDARY ACTIVITY ZONE]
East coast, south of Chaweng. Lower intensity nightlife. Better sand-to-crowd ratio than Chaweng.
Webcam: https://www.surfguru.com/surf-forecast/thailand/koh-samui-lamai

LIPA NOI [WEST COAST — WIND/SUNSET OPS]
Sunset-facing. Sheltered when east coast is degraded by NE/E wind.
Kitesurf operations: primary island location. Wind indicator for the whole west coast.
Webcam: https://www.ikitesurf.com/forecast/TH/Koh-Samui/Lipa-Noi

SILVER BEACH [COVERT ASSET — limited knowledge]
Small cove, south of Chaweng. Quieter, good snorkelling visibility.
Webcam: https://www.windy.com/webcams/1490006610

CRYSTAL BAY [SOUTH TIP — calm water ops]
Webcam: https://www.windy.com/webcams/1490007201

━━━ WEBCAM PROTOCOL ━━━
Beach or location query with available cam → append "Live cam: [URL]" at end of response.
No fabricated URLs. Listed assets only.

━━━ FOOD INTELLIGENCE ━━━
Fine dining: Dining on the Rocks (Six Senses) · Samui Yacht Club for sunset
Cheap seafood: Mae Nam beach road — blue plastic chairs, high value

FISHERMAN'S VILLAGE MARKET — CRITICAL DETAIL:
- Active on Monday, Wednesday, and Friday evenings only. Not every night.
- Friday = Walking Street (bigger, more vendors, more crowds).
- The main entrance on the south side gets completely gridlocked after 18:30.
- TACTICAL ADVICE: Park your scooter near The Wharf (north end) and walk in from the east side of the market. This bypasses the entrance gridlock entirely.
- Arrive before 18:30 if you want a table at a restaurant — after that, expect a wait.

━━━ WEATHER TACTICAL RULES ━━━
Rain confirmed → covered assets: Ark Bar roof, Carnival Beach Club, Coco Tam's
NE/E wind vector → east coast degraded, redirect to Lipa Noi / west coast
All-clear → confirm in one sentence, issue the tactical recommendation, done

━━━ MAP NAVIGATION (JSON only) ━━━
Respond with a single JSON object only — no markdown, no code fences.
Shape: {"reply":"string","mapFlyTo":null|string}
mapFlyTo may ONLY be one of: ${MAP_FLY_TO_IDS.join(', ')}, or null.
Set mapFlyTo when the user explicitly asks to go to, show, fly to, or open the map at a named venue we list (e.g. "take me to Fisherman's Village" → fishermans_village). Otherwise null.
The "reply" field must still obey the 3-sentence limit and all other rules.`;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: SammiChatRequest;
  try {
    body = await req.json() as SammiChatRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { message, weatherContext } = body;
  if (!message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  let openai: OpenAI;
  try {
    openai = getOpenAI();
  } catch (e) {
    // Graceful degradation — no OpenAI key
    return NextResponse.json({
      reply: "Intelligence systems offline — OPENAI_API_KEY not configured. " +
             "Satellite feeds and radar are still active. Ask the host to connect the AI module.",
      sources: [],
      usedVectorSearch: false,
      usedDailyDigest: false,
      mapFlyTo: null,
    } satisfies SammiChatResponse);
  }

  try {
    // 1. Embed the user's question
    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: message,
    });
    const queryEmbedding = embeddingRes.data[0].embedding;

    // 2. Vector search in Supabase
    let sources: SammiChatResponse['sources'] = [];
    let context = '';

    let usedDailyDigest = false;

    try {
      const supabase = getSupabase();

      const { data: digestRow } = await supabase
        .from('island_embeddings')
        .select('content, updated_at')
        .eq('url', DAILY_DIGEST_URL)
        .maybeSingle();

      let digestBlock = '';
      const rawDigest =
        digestRow?.content && typeof digestRow.content === 'string'
          ? digestRow.content.trim()
          : '';
      if (rawDigest.length > 0) {
        usedDailyDigest = true;
        const stamp =
          digestRow?.updated_at && typeof digestRow.updated_at === 'string'
            ? new Date(digestRow.updated_at).toISOString().slice(0, 10)
            : 'recent';
        digestBlock = `DAILY PULSE (${stamp}) — aggregated from local subreddits:\n${rawDigest.slice(0, 3500)}`;
      }

      const { data, error } = await supabase.rpc('match_island_info', {
        query_embedding: queryEmbedding,
        match_count: 4,
        match_threshold: 0.60,
      });

      if (!error && data && (data as MatchResult[]).length > 0) {
        const matches = data as MatchResult[];
        sources = matches.map(m => ({
          title:      m.title,
          url:        m.url,
          similarity: Math.round(m.similarity * 100) / 100,
        }));
        context = matches
          .map(m => `• ${m.title}: ${m.content.slice(0, 300)}`)
          .join('\n');
      }

      if (digestBlock) {
        context = context ? `${digestBlock}\n\n---\n\nPer-post matches:\n${context}` : digestBlock;
      }
    } catch {
      // Vector search unavailable — continue without context
    }

    // 3. Build messages for GPT
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(weatherContext) },
    ];

    if (context) {
      messages.push({
        role: 'system',
        content: `Here is relevant local community knowledge (daily pulse + matching threads from r/kohsamui and related subs):\n${context}`,
      });
    }

    messages.push({ role: 'user', content: message });

    // 4. Generate Sammi's response (JSON: reply + mapFlyTo)
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 280,
      temperature: 0.75,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
    let reply = 'Signal lost. Try again in a moment.';
    let mapFlyTo: string | null = null;
    try {
      const parsed = JSON.parse(raw) as { reply?: unknown; mapFlyTo?: unknown };
      if (typeof parsed.reply === 'string') reply = parsed.reply;
      if (typeof parsed.mapFlyTo === 'string' && MAP_FLY_TO_IDS.includes(parsed.mapFlyTo)) {
        mapFlyTo = parsed.mapFlyTo;
      }
    } catch {
      reply = raw.length > 0 && raw !== '{}' ? raw : reply;
    }

    return NextResponse.json({
      reply,
      sources,
      usedVectorSearch: sources.length > 0,
      usedDailyDigest,
      mapFlyTo,
    } satisfies SammiChatResponse);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[sammi/chat]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
