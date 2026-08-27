/**
 * Data Freshness — tracks age of each of Sammi's three sources and
 * generates human/Sammi-voice labels for display + post injection.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SourceFreshness {
  ageMinutes: number;        // how old is the data right now
  label: string;             // UI label: "12m ago", "~live", etc.
  isStale: boolean;          // true when data is too old to trust
  staleThresholdMinutes: number;
  sammiNote: string | null;  // Sammi's voice comment if stale, null if fresh
  syncTimeIct: string;       // "14:30 ICT" — exact time of last sync
}

export interface TripleFreshness {
  spire:  SourceFreshness;  // SPIRE orbital  — updates ~1x/hour
  metar:  SourceFreshness;  // VTSM airport   — updates every 30 min
  radar:  SourceFreshness;  // mainland radar — ~10 min (treated as live)
  overallFresh: boolean;    // true when all critical sources are within tolerance
  postLine: string;         // Sammi's in-post "Last Verified" sentence
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function ageMinutes(unixSeconds: number, nowUnix?: number): number {
  const now = nowUnix ?? Math.floor(Date.now() / 1000);
  return Math.round((now - unixSeconds) / 60);
}

export function ageLabel(minutes: number): string {
  if (minutes < 2)  return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

function ictTimeStr(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
  });
}

// ── Per-source calculators ─────────────────────────────────────────────────────

/**
 * SPIRE: forecast rows have a `time` ISO string.
 * The first row is valid for the current hour; age = now minus that hour boundary.
 */
export function spireFreshness(firstRowTime: string): SourceFreshness {
  const validUnix  = Math.floor(new Date(firstRowTime).getTime() / 1000);
  const age        = ageMinutes(validUnix);
  const stale      = age > 90;   // SPIRE should never be >90 min behind
  const syncTime   = ictTimeStr(validUnix);

  const sammiNote  = stale
    ? `My satellite data is running ${age} minutes behind schedule — unusual. I'm leaning on the airport sensors and the mainland radar while my constellation catches up.`
    : null;

  const label = age < 5 ? 'just updated' : `${age}m ago`;

  return {
    ageMinutes: age,
    label,
    isStale: stale,
    staleThresholdMinutes: 90,
    sammiNote,
    syncTimeIct: syncTime,
  };
}

/**
 * METAR (VTSM): published on the hour and half-hour.
 * obsTime = Unix seconds of observation. Stale > 45 min (one cycle missed).
 */
export function metarFreshness(obsTimeUnix: number, nowUnix?: number): SourceFreshness {
  const age      = ageMinutes(obsTimeUnix, nowUnix);
  const stale    = age > 45;
  const syncTime = ictTimeStr(obsTimeUnix);

  let sammiNote: string | null = null;
  if (age > 60) {
    sammiNote = `My link to the airport sensors hasn't synced in ${age} minutes — that's unusual. I'm running on satellite data and the mainland radar right now. Keep an eye on conditions directly.`;
  } else if (stale) {
    sammiNote = `The airport sensors are buffering — last sync was ${age} minutes ago. The mainland radar is still live, so I'm not flying blind. But check back shortly.`;
  }

  // Describe freshness relative to METAR's 30-min cycle
  let label: string;
  if (age < 5)       label = 'just issued';
  else if (age < 15) label = `${age}m ago (fresh)`;
  else if (age < 30) label = `${age}m ago`;
  else if (age < 45) label = `${age}m ago (next due soon)`;
  else               label = `${age}m ago ⚠️`;

  return {
    ageMinutes: age,
    label,
    isStale: stale,
    staleThresholdMinutes: 45,
    sammiNote,
    syncTimeIct: syncTime,
  };
}

/**
 * Rain radar (RainViewer / TMD via Surat Thani):
 * Updates every 10 minutes. We treat it as effectively live.
 * If we have a radar frame timestamp, use it; otherwise assume current.
 */
export function radarFreshness(lastFrameUnix?: number): SourceFreshness {
  const now      = Math.floor(Date.now() / 1000);
  const ts       = lastFrameUnix ?? now;
  const age      = ageMinutes(ts);
  const stale    = age > 20;  // two missed cycles
  const syncTime = ictTimeStr(ts);

  const sammiNote = stale
    ? `The mainland rain radar hasn't refreshed in ${age} minutes. I'm flagging this — I'll give you satellite context but treat my rain assessment with slightly more caution than usual.`
    : null;

  const label = age < 2 ? '~live' : `~${age}m ago`;

  return {
    ageMinutes: age,
    label,
    isStale: stale,
    staleThresholdMinutes: 20,
    sammiNote,
    syncTimeIct: syncTime,
  };
}

// ── Combined freshness + post line ────────────────────────────────────────────

/**
 * Build the full triple freshness object and Sammi's "Last Verified" post line.
 */
export function buildTripleFreshness(
  spireFirstRowTime: string,
  metarObsTimeUnix: number,
  radarLastFrameUnix?: number,
): TripleFreshness {
  const spire = spireFreshness(spireFirstRowTime);
  const metar = metarFreshness(metarObsTimeUnix);
  const radar = radarFreshness(radarLastFrameUnix);

  const overallFresh = !spire.isStale && !metar.isStale && !radar.isStale;

  // Build Sammi's in-post "Last Verified" sentence
  let postLine: string;

  if (overallFresh) {
    // All sources fresh — pick a natural brag based on most recent airport sync
    const metarMin = metar.ageMinutes;
    if (metarMin < 5) {
      postLine = `*Verified just now — the ${metar.syncTimeIct} airport sensor sequence just dropped and it confirms everything I told you.*`;
    } else if (metarMin < 20) {
      postLine = `*Confirmed ${metar.ageMinutes} minutes ago by the ${metar.syncTimeIct} airstrip sequence — my satellite data cross-checks perfectly.*`;
    } else {
      postLine = `*Last airport sync: ${metar.syncTimeIct} ICT · Satellite data: ${spire.syncTimeIct} ICT · Mainland radar: ${radar.label}*`;
    }
  } else {
    // At least one source is stale — acknowledge it in Sammi's voice
    const staleNotes = [spire, metar, radar]
      .filter(s => s.isStale && s.sammiNote)
      .map(s => s.sammiNote!)
      .join(' ');
    postLine = `*Note from Sammi: ${staleNotes || "One of my data sources is running behind — I'm being transparent because that's what real instruments do."}*`;
  }

  return { spire, metar, radar, overallFresh, postLine };
}

/**
 * Format freshness context for Claude's user message.
 */
export function formatFreshnessContext(f: TripleFreshness): string {
  const lines = [
    '=== DATA FRESHNESS (be transparent about this in the post) ===',
    `📡 SPIRE orbital:       last sync ${f.spire.syncTimeIct} ICT (${f.spire.label})${f.spire.isStale ? ' ⚠️ STALE' : ' ✓'}`,
    `🌧️ Mainland rain radar: ${f.radar.label} ✓  (updates every ~10 min, treated as live)`,
    `✈️ Airport sensors:     last sync ${f.metar.syncTimeIct} ICT (${f.metar.label})${f.metar.isStale ? ' ⚠️ STALE' : ' ✓'}`,
    '',
    `Overall data status: ${f.overallFresh ? 'ALL SOURCES FRESH — Sammi can be fully confident' : 'ONE OR MORE SOURCES STALE — Sammi must acknowledge this gracefully'}`,
    '',
  ];

  const staleNotes = [f.spire, f.metar, f.radar]
    .filter(s => s.isStale && s.sammiNote)
    .map(s => `  • ${s.sammiNote}`);

  if (staleNotes.length > 0) {
    lines.push('STALE SOURCE HANDLING — weave these notes into the post:');
    lines.push(...staleNotes);
    lines.push('');
  }

  lines.push(`LAST VERIFIED LINE — append this after the postscript:`);
  lines.push(f.postLine);

  return lines.join('\n');
}
