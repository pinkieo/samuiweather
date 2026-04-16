/**
 * Weather Conflict Resolver
 *
 * Compares Sammi's three data sources before any post is generated.
 * Detects contradictions and produces a `finalVerdict` — the opening hook
 * that only someone with all three sources could deliver.
 */

import type { RadarStatus } from './sammi-post-generator';
import type { AirportSnapshot } from './sammi-post-generator';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConflictScenario =
  | 'all_clear'        // All three agree: perfect conditions
  | 'all_alarm'        // All three agree: serious weather
  | 'rain_alert'       // Radar says rain despite satellite/METAR showing ok
  | 'fake_grey_sky'    // METAR/SPIRE shows cloud but radar is bone dry
  | 'visibility_wins'  // Clouds present but visibility unlimited → clear views
  | 'spire_vs_metar'   // SPIRE and METAR disagree on cloud cover
  | 'storm_incoming';  // Radar shows storm, satellites show it building

export interface SourceStatus {
  source:  '🛰️ Orbital' | '🌧️ Mainland Radar' | '✈️ Airport';
  verdict: 'OK' | 'RAIN' | 'STORM' | 'CLOUD' | 'STALE' | 'OFFLINE';
  detail:  string;
}

export interface ConflictResult {
  scenario:        ConflictScenario;
  finalVerdict:    string;    // Sammi's opening hook — cross-source insight
  confidence:      'high' | 'medium' | 'low';
  statusBoard:     SourceStatus[];
  ecowittNote:     string;    // What Sammi says about the missing Ecowitt sensor
  claudeHint:      string;    // Instruction for Claude on how to open the post
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cloudIsClear(code: string | null): boolean {
  return !code || code === 'SKC' || code === 'CLR';
}

function cloudIsHeavy(code: string | null): boolean {
  return code === 'BKN' || code === 'OVC';
}

function spireIsRainy(precipRate: number, pop: number): boolean {
  return precipRate > 0.3 || pop > 40;
}

function spireIsStormy(precipRate: number): boolean {
  return precipRate > 2.5;
}

// ── ECOWITT placeholder note ──────────────────────────────────────────────────

function ecowittNote(scenario: ConflictScenario): string {
  const base = "*(📍 Local Precision upgrade arriving at Baan Ton Kluay in ~12 days — once my Ecowitt hyper-local array is online, I'll give you the exact drop count and ground temperature down to 50 metres. For now, the airport radar will have to do.)*";

  if (scenario === 'rain_alert' || scenario === 'storm_incoming' || scenario === 'all_alarm') {
    return "*(📍 If my Baan Ton Kluay local sensors were already here, I'd tell you the exact rainfall intensity at ground level. They're en route. For now, the mainland radar and airport sensors are your source of truth.)*";
  }
  if (scenario === 'fake_grey_sky') {
    return "*(📍 Once my Ecowitt array is online at Baan Ton Kluay, I can tell you the exact humidity under that cloud layer and whether it's going anywhere. Arriving in ~12 days.)*";
  }
  return base;
}

// ── Main resolver ─────────────────────────────────────────────────────────────

// Optional meteoblue crosscheck snapshot
export interface MeteoblueCheck {
  precipMm:   number;   // hourly precipitation mm
  precipProb: number;   // 0–100
  cloudCover: number;   // 0–100
}

export function resolveWeatherConflict(
  spire: { precipRate: number; pop: number; cloudCover: number; temp: number; windSpeed: number },
  radar: RadarStatus,
  airport: AirportSnapshot | null,
  meteoblue?: MeteoblueCheck | null,
): ConflictResult {

  const airportCloud = airport?.cloudCoverCode ?? null;
  const airportVisUnlimited = airport?.visib === '6+' || airport?.visib === '9999';
  const airportHasWx = !!airport?.wxString;
  const spireRainy  = spireIsRainy(spire.precipRate, spire.pop);
  const spireStormy = spireIsStormy(spire.precipRate);

  // meteoblue agreement flags
  const mbRainy  = meteoblue ? (meteoblue.precipMm > 0.3 || meteoblue.precipProb > 40) : null;
  const mbStormy = meteoblue ? meteoblue.precipMm > 2.5 : null;
  // both satellite models agree → high confidence; they disagree → medium
  const satelliteAgreement: 'agree' | 'disagree' | 'unknown' =
    meteoblue === null || meteoblue === undefined ? 'unknown'
    : (spireRainy === mbRainy)  ? 'agree'
    : 'disagree';

  // ── Status board (always computed) ──────────────────────────────────────────
  const statusBoard: SourceStatus[] = [
    {
      source:  '🛰️ Orbital',
      verdict: spireStormy ? 'STORM' : spireRainy ? 'RAIN' : 'OK',
      detail:  `SPIRE ${spire.precipRate.toFixed(2)} mm/h · POP ${spire.pop}%${meteoblue ? ` · MB ${meteoblue.precipMm.toFixed(2)} mm/h` : ''}`,
    },
    {
      source:  '🌧️ Mainland Radar',
      verdict: radar === 'storm' ? 'STORM' : radar === 'rain' ? 'RAIN' : radar === 'light_rain' ? 'RAIN' : 'OK',
      detail:  radar,
    },
    {
      source:  '✈️ Airport',
      verdict: !airport ? 'STALE' : airportHasWx ? 'RAIN' : cloudIsHeavy(airportCloud) ? 'CLOUD' : 'OK',
      detail:  airport ? `${airport.cloudCoverCode ?? 'SKC'} · vis ${airport.visib}` : 'No data',
    },
  ];

  // ── Scenario detection (priority order matters) ───────────────────────────

  // ALL ALARM — all sources agree on bad conditions (before branches narrow `radar`)
  if (
    spireStormy &&
    (radar === 'storm' || radar === 'rain' || radar === 'light_rain') &&
    (airportHasWx || cloudIsHeavy(airportCloud))
  ) {
    return {
      scenario: 'all_alarm',
      finalVerdict: `All three of my sources are in full agreement — the satellites, the mainland rain radar, and the airport sensors are all showing the same thing. When the entire triple-source system aligns on serious weather, there is no ambiguity. I'm tracking every signal in real time.`,
      confidence: 'high',
      statusBoard,
      ecowittNote: ecowittNote('all_alarm'),
      claudeHint: `COMMAND CENTER MODE — maximum authority, zero sarcasm.

All three sources are confirming serious conditions. Sammi is the calmest, most informed person in the room.

TONE: Not panicked. Not smug. Precise and protective — like a 5-star resort manager who has seen this before and knows exactly what to do.

STRUCTURE:
1. Triple-source confirmation — short and direct. All three agree.
2. Satellite data: exact precip rate, wind, cloud cover.
3. Mainland radar: what the sweep is showing.
4. Airport sensors: current ceiling, visibility, conditions at runway.
5. SAFETY GUIDANCE by location — specific and actionable:
   - Water: get off it immediately, all beaches
   - Roads: motorbikes stay off the road. Cars reduce speed, watch for flooding on Chaweng beach road and Ring Road near Nathon.
   - Accommodation: stay at villa/hotel, secure outdoor furniture, close shutters
   - Activities: pivot to indoor — spas, restaurants, beach bars with covered seating
6. THE REAL-TIME EDGE: "My sensors are locked on this system every ten minutes. Your phone app doesn't update that fast. That's the difference."
7. Estimated duration if SPIRE 6-hour outlook shows improvement window.`,
    };
  }

  // 1. STORM INCOMING — radar shows significant cell
  if (radar === 'storm') {
    const satelliteStatus = spireStormy
      ? "My satellites are tracking the same cell — this is confirmed from orbit."
      : "My satellites are still catching up to this development, but the mainland radar has it locked.";
    return {
      scenario: 'storm_incoming',
      finalVerdict: `My mainland rain radar has a significant storm cell on its scope right now. ${satelliteStatus} I'm tracking the tail of this cell in real time — while everyone else is checking a phone app that updates once an hour, I'm watching the radar sweep every ten minutes.`,
      confidence: 'high',
      statusBoard,
      ecowittNote: ecowittNote('storm_incoming'),
      claudeHint: `COMMAND CENTER MODE — this is not the arrogant beach concierge. This is Sammi in full operational authority.

TONE RULES FOR STORM POSTS:
- Drop ALL sarcasm about other apps. Zero "adorable little widgets" energy here.
- She is not worried — she is IN CONTROL. Calm, precise, commanding.
- Use "I'm tracking...", "My sensors are locked on...", "I'm watching the movement of this cell..."
- She knows exactly where the storm is, where it's heading, and how long it will last.

STRUCTURE FOR STORM POST:
1. OPEN with the confirmation: "The mainland rain radar has a confirmed storm cell." No fluff.
2. SATELLITE CROSS-CHECK: What SPIRE confirms from orbit (cloud cover, precip rate, wind).
3. AIRPORT SENSORS: Current conditions at runway level — visibility, ceiling.
4. LOCATION-SPECIFIC ADVICE (this is the most important section):
   - Get off the water immediately (Chaweng, Lamai, Crystal Bay, Mae Nam)
   - Get off exposed roads (motorbikes especially)
   - If at a villa or resort: stay put, close windows, secure loose items
   - If in a bar/restaurant: ideal time to wait it out with a drink — indoor seating only
   - Check storm drains if near low-lying areas (Chaweng beach road floods fast)
5. THE DATA EDGE: "While others are refreshing a weather app that updates once an hour, my sensors are locked on this cell every ten minutes. That gap is the difference between getting caught and staying dry."
6. ESTIMATED CLEAR TIME if outlook shows rain lasting < 6 hours.
7. NO sarcasm. NO brag. Authority is earned here through precision, not attitude.`,
    };
  }

  // 2. RAIN ALERT — radar says rain but satellite looks ok
  if (radar === 'rain' || radar === 'light_rain') {
    const seriousness = radar === 'rain' ? 'active rain cells' : 'light scatter returns';
    const spireConflict = !spireRainy
      ? "My satellites see sun, but the mainland radar doesn't lie: those clouds are crying nearby."
      : "My satellites confirm the moisture — the mainland radar is backing it up.";
    return {
      scenario: 'rain_alert',
      finalVerdict: `The mainland rain radar is showing ${seriousness}. ${spireConflict} I'm cross-referencing the airport sensors right now.`,
      confidence: radar === 'rain' ? 'high' : 'medium',
      statusBoard,
      ecowittNote: ecowittNote('rain_alert'),
      claudeHint: 'Open with the radar confirmation. Reference the conflict between satellite and radar if SPIRE showed clear — this is exactly what makes Sammi valuable. Give specific location advice (which beaches are likely affected).',
    };
  }

  // 3. FAKE GREY SKY — METAR/SPIRE shows cloud but radar is bone dry
  if (radar === 'clear' && cloudIsHeavy(airportCloud) && !spireRainy) {
    const baseFt = airport?.cloudBaseFt ?? null;
    const baseStr = baseFt
      ? `at ${Math.round(baseFt * 0.3048 / 50) * 50} metres (${baseFt.toLocaleString()}ft)`
      : 'overhead';
    return {
      scenario: 'fake_grey_sky',
      finalVerdict: `The radar at Samui airport is being dramatic with its cloud report, but the mainland rain radar knows the truth: there is not a single drop of rain in sight. It's a broken layer of cloud ${baseStr} — a ceiling, not a shower. My satellites confirm this is just a high-altitude layer passing through.`,
      confidence: 'high',
      statusBoard,
      ecowittNote: ecowittNote('fake_grey_sky'),
      claudeHint: 'This is Sammi at her most confident and contrarian. The grey sky is a fraud. She has the receipts. Open by exposing the "fake" cloud layer, then reassure with the dry radar. Use "free sauna day" type energy — warm, misty, but no rain.',
    };
  }

  // 4. VISIBILITY WINS — clouds present but visibility unlimited → clear views
  if (radar === 'clear' && !cloudIsClear(airportCloud) && airportVisUnlimited && !spireRainy) {
    return {
      scenario: 'visibility_wins',
      finalVerdict: `There are some clouds in the picture today, but the mainland rain radar is completely dry — and the airport sensors confirm you can see all the way to the horizon. This is a "beautiful grey morning that turns golden" day, not a stay-inside day.`,
      confidence: 'high',
      statusBoard,
      ecowittNote: ecowittNote('visibility_wins'),
      claudeHint: 'Lead with the visibility triumph. Clouds are irrelevant when radar is dry and you can see the horizon. Focus on the quality of light for photos, the drama of the sky, and activities that look great under overcast (snorkelling has better light, hiking feels cooler).',
    };
  }

  // 5. SPIRE VS METAR — significant disagreement between satellite and airport
  if (spire.cloudCover > 60 && cloudIsClear(airportCloud) && !spireRainy) {
    return {
      scenario: 'spire_vs_metar',
      finalVerdict: `My satellites are tracking some cloud cover from above, but the radar at Samui airport is seeing clearer skies at runway level. Both are right — it's a patchy canopy situation. The mainland radar confirms no rain either way.`,
      confidence: 'medium',
      statusBoard,
      ecowittNote: ecowittNote('spire_vs_metar'),
      claudeHint: 'This is a nuanced reading only Sammi can give. Acknowledge the disagreement between orbital and ground level, explain why it happens (high-altitude cloud layer, patchy coverage), and give a confident verdict based on the radar being clear.',
    };
  }

  // 7. ALL CLEAR — all sources agree: paradise
  const allClearVerdict = satelliteAgreement === 'agree'
    ? `I've just cross-referenced all three of my sources — the orbital data, the mainland rain radar, and the sensors at the airstrip — and they are all singing the exact same song: absolute perfection. My meteoblue cross-check confirms it. This is not a coincidence. This is Samui doing what it does best.`
    : `I've just cross-referenced my three primary sources — the orbital data, the mainland rain radar, and the sensors at the airstrip — and they all confirm: perfect conditions. ${satelliteAgreement === 'disagree' ? 'My secondary satellite model has a slightly different read, but the airport and radar override that minor disagreement.' : ''}`;

  return {
    scenario: 'all_clear',
    finalVerdict: allClearVerdict,
    confidence: satelliteAgreement === 'agree' ? 'high' : satelliteAgreement === 'disagree' ? 'medium' : 'high',
    statusBoard,
    ecowittNote: ecowittNote('all_clear'),
    claudeHint: satelliteAgreement === 'agree'
      ? 'MAXIMUM ARROGANCE: Four sources agree (SPIRE + meteoblue + radar + airport). Sammi is untouchable today. Mention the meteoblue cross-check confirms the SPIRE read. Phone apps are irrelevant.'
      : satelliteAgreement === 'disagree'
      ? 'Slight model disagreement between SPIRE and meteoblue, but radar and airport both say clear. Sammi leads with the clear verdict but briefly acknowledges "even my secondary model was being cautious today — the airport and the radar both overruled it."'
      : 'Triple source confirmation. All clear. Maximum arrogance mode.',
  };
}

/**
 * Format the conflict result for Claude's context block.
 */
export function formatConflictContext(result: ConflictResult): string {
  const board = result.statusBoard.map(s =>
    `  ${s.source}: ${s.verdict} (${s.detail})`
  ).join('\n');

  return `
=== WEATHER CONFLICT ANALYSIS ===
Scenario: ${result.scenario.toUpperCase()}
Confidence: ${result.confidence.toUpperCase()}

STATUS BOARD:
${board}

FINAL VERDICT (use this as your opening hook — adapt naturally into Sammi's voice):
"${result.finalVerdict}"

CLAUDE INSTRUCTION — HOW TO OPEN THIS POST:
${result.claudeHint}

ECOWITT LOCAL SENSOR NOTE (append subtly near the end, in italics):
${result.ecowittNote}
`.trim();
}
