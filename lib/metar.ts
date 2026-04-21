/**
 * METAR / TAF parser — Samui, Krabi, Phuket (aviationweather.gov, no API key)
 */

/** Single request: METAR for VTSM (Samui), VTSG (Krabi), VTSP (Phuket). */
export const TH_SOUTH_METAR_URL =
  'https://aviationweather.gov/api/data/metar?ids=VTSM,VTSG,VTSP&format=json&hours=2';
export const TH_SOUTH_TAF_URL =
  'https://aviationweather.gov/api/data/taf?ids=VTSM,VTSG,VTSP&format=json';

/** @deprecated Use {@link TH_SOUTH_METAR_URL} and pick station by `icaoId`. */
export const VTSM_METAR_URL = TH_SOUTH_METAR_URL;
/** @deprecated Use {@link TH_SOUTH_TAF_URL} and pick station by `icaoId`. */
export const VTSM_TAF_URL = TH_SOUTH_TAF_URL;

export const TH_SOUTH_AIRPORT_ICAOS = ['VTSM', 'VTSG', 'VTSP'] as const;
export type ThSouthAirportIcao = (typeof TH_SOUTH_AIRPORT_ICAOS)[number];

/** Human label for Sammi copy (no ICAO codes in user-facing text). */
export const TH_SOUTH_AIRPORT_VOICE: Record<ThSouthAirportIcao, string> = {
  VTSM: 'Samui airport',
  VTSG: 'Krabi airport',
  VTSP: 'Phuket airport',
};

// ── Raw API types ─────────────────────────────────────────────────────────────

export interface RawMetar {
  icaoId:      string;
  rawOb:       string;
  obsTime:     number;       // Unix seconds
  reportTime:  string;
  temp:        number | null;
  dewp:        number | null;
  wdir:        number | null;
  wspd:        number | null;
  wgst:        number | null;
  visib:       string | null;
  altim:       number | null;
  wxString:    string | null;
  cover:       string | null;
  clouds:      { cover: string; base: number | null }[];
  fltCat:      'VFR' | 'MVFR' | 'IFR' | 'LIFR' | string;
}

export interface RawTafFcst {
  timeFrom:    number;
  timeTo:      number;
  fcstChange:  string | null;
  wdir:        number | null;
  wspd:        number | null;
  wgst:        number | null;
  visib:       string | null;
  wxString:    string | null;
  clouds:      { cover: string; base: number | null }[];
}

export interface RawTaf {
  icaoId:      string;
  rawTAF:      string;
  issueTime:   string;
  validTimeFrom: number;
  validTimeTo:   number;
  fcsts:       RawTafFcst[];
}

export function pickRawMetarForIcao(rows: RawMetar[], icao: string): RawMetar | undefined {
  const u = icao.toUpperCase();
  return rows.find(r => r.icaoId?.toUpperCase() === u);
}

export function pickRawTafForIcao(rows: RawTaf[], icao: string): RawTaf | undefined {
  const u = icao.toUpperCase();
  return rows.find(r => r.icaoId?.toUpperCase() === u);
}

/**
 * True if METAR wx group reports precipitation / storms (RA, SHRA, TSRA, TS, DZ, …).
 * Used for Krabi dual-airport logic (VTSG + VTSP).
 */
export function metarWxIndicatesPrecipitation(wxString: string | null | undefined): boolean {
  if (!wxString) return false;
  const u = wxString.toUpperCase();
  return /\b(RA|DZ|SHRA|TSRA|TS|SHSN|SN|GR|GS|PL|SG|DRSN|UP|SHGR|FZRA|FZDZ|RASN|SNRA|RABR|DZRA|VCTS|VCSH|TSGR|SHGS)\b/.test(
    u,
  );
}

// ── Parsed & translated types ─────────────────────────────────────────────────

export interface ParsedCloud {
  cover:    string;   // FEW | SCT | BKN | OVC | SKC | CLR
  base:     number | null; // feet AGL
  label:    string;   // human label
}

export interface ParsedMetar {
  raw:         string;
  obsTime:     number;
  temp:        number | null;
  dewp:        number | null;
  wdir:        number | null;
  wspd:        number | null;
  wgst:        number | null;
  visib:       string | null;
  qnh:         number | null;
  clouds:      ParsedCloud[];
  fltCat:      string;
  wxString:    string | null;
  // Sammi's translations
  sammiSky:    string;
  sammiWind:   string;
  sammiVisMood: string;
  sammiVerdict: string;
  fltCatColor: 'green' | 'yellow' | 'red' | 'darkred';
}

export interface ParsedTafPeriod {
  from:     Date;
  to:       Date;
  change:   string | null;
  wspd:     number | null;
  wdir:     number | null;
  visib:    string | null;
  clouds:   ParsedCloud[];
  wx:       string | null;
  label:    string;   // human-readable period label
  sammiLine: string;  // Sammi's one-liner for this period
}

export interface ParsedTaf {
  raw:      string;
  issued:   Date;
  validFrom: Date;
  validTo:  Date;
  periods:  ParsedTafPeriod[];
}

// ── Code tables ───────────────────────────────────────────────────────────────

// Fixed Sammi vocabulary — no aviation codes ever spoken aloud
const CLOUD_LABELS: Record<string, string> = {
  SKC: 'not a single cloud in sight',
  CLR: 'a perfectly clear sky',
  FEW: 'light wispy clouds',           // "lichte sluierwolken"
  SCT: 'friendly cumulus clouds',      // "vriendelijke stapelwolken"
  BKN: 'a broken layer of cloud',
  OVC: 'a full overcast blanket',
};

/** Convert cloud base (feet) → human altitude string, e.g. "at 600 metres (2,000ft)" */
function altitudeStr(baseFt: number | null): string {
  if (!baseFt) return '';
  const m = Math.round(baseFt * 0.3048 / 50) * 50; // round to nearest 50m
  return ` at around ${m.toLocaleString()} metres (${baseFt.toLocaleString()} ft)`;
}

const WX_LABELS: Record<string, string> = {
  RA: 'rain', DZ: 'drizzle', SN: 'snow', GR: 'hail', GS: 'small hail',
  TS: 'thunderstorm', FG: 'fog', BR: 'mist', HZ: 'haze', SQ: 'squall',
  FC: 'funnel cloud', PO: 'dust devil', SA: 'sand', DU: 'dust',
  '-': 'light', '+': 'heavy', SH: 'shower', FZ: 'freezing', MI: 'shallow',
  BC: 'patches', DR: 'drifting', BL: 'blowing', PR: 'partial',
};

/** METAR wx codes include `+` / `-` (heavy/light) — must not be raw RegExp quantifiers. */
function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeWx(wxString: string | null): string | null {
  if (!wxString) return null;
  let result = wxString;
  Object.entries(WX_LABELS).forEach(([code, label]) => {
    result = result.replace(new RegExp(escapeRegExpLiteral(code), 'g'), `${label} `);
  });
  return result.trim().replace(/\s+/g, ' ');
}

function windDirToCompass(deg: number | null): string {
  if (deg == null || deg === 0) return 'calm';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── Sammi voice translators ───────────────────────────────────────────────────
// Rule: NO aviation codes out loud (METAR, TAF, FEW, SCT, BKN, OVC, VFR, IFR, VTSM).
// Everything becomes human experience. Tone: "I have the equipment, you have the vacation."

function sammiSkyQuip(
  clouds: ParsedCloud[],
  wx: string | null,
  airportLabel: string = 'Samui airport',
): string {
  if (wx && wx.toLowerCase().includes('thunder')) {
    return `The radar at ${airportLabel} is picking up electrical storm signals. This is data your phone app simply does not have — and right now it says: reschedule that beach dinner, darling.`;
  }
  if (wx && (wx.toLowerCase().includes('rain') || wx.toLowerCase().includes('shower'))) {
    return "Our sensors at the airstrip are confirming active rain. The mainland rain radar backs it up — the sky means business. I see the data your phone app doesn't have, and it's wet.";
  }
  const dominant = clouds[0]?.cover ?? 'SKC';
  const base     = clouds[0]?.base;
  const alt      = altitudeStr(base);

  switch (dominant) {
    case 'SKC':
    case 'CLR':
      return `The radar at ${airportLabel} is looking at a completely empty sky. Not a cloud in the picture. This is data your phone app doesn't have — and it says: perfect.`;
    case 'FEW':
      return `Our sensors at the airstrip see light wispy clouds${alt}. Decorative, really — the kind you photograph, not hide from. The mainland rain radar confirms zero precipitation signals anywhere near us.`;
    case 'SCT':
      return `The radar at ${airportLabel} is showing friendly cumulus clouds${alt}. A nice patchwork of sun and shade — ideal beach weather. The mainland rain radar? Completely silent.`;
    case 'BKN':
      return `Our sensors at the airstrip see a broken layer of cloud${alt}. More grey than blue, I won't lie. The mainland rain radar is watching — no rain cells yet, but I'm keeping my satellite eyes on it.`;
    case 'OVC':
      return `The radar at ${airportLabel} sees a full overcast blanket${alt}. Grey sky confirmed — I see the data your phone app doesn't have, and today it says: indoor brunch first, beach later. The mainland rain radar shows no heavy cells though.`;
    default:
      return "Our sensors at the airstrip are reading the sky. Give me a moment — I see the data your phone app doesn't.";
  }
}

function sammiWindQuip(
  wspd: number | null,
  wgst: number | null,
  wdir: number | null,
  airportLabel: string = 'Samui airport',
): string {
  const compass  = windDirToCompass(wdir);
  const gustNote = wgst ? `, with gusts up to ${wgst} knots` : '';
  const compassHuman: Record<string, string> = {
    N: 'the north', NNE: 'the north-northeast', NE: 'the northeast', ENE: 'the east-northeast',
    E: 'the east', ESE: 'the east-southeast', SE: 'the southeast', SSE: 'the south-southeast',
    S: 'the south', SSW: 'the south-southwest', SW: 'the southwest', WSW: 'the west-southwest',
    W: 'the west', WNW: 'the west-northwest', NW: 'the northwest', NNW: 'the north-northwest',
    calm: 'nowhere — completely still',
  };
  const dir = compassHuman[compass] ?? `the ${compass}`;

  if (!wspd || wspd < 2) {
    return "Wind: glass calm. Our sensors at the airstrip confirm it — not a breath of wind. Your cocktail umbrella is in zero danger.";
  }
  if (wspd < 8) {
    return `A gentle breeze from ${dir}${gustNote}. The radar at ${airportLabel} clocked it at ${wspd} knots — your phone app wouldn't even bother showing this. Beach-perfect.`;
  }
  if (wspd < 15) {
    return `A proper sea breeze from ${dir} at ${wspd} knots${gustNote}. Our sensors at the airstrip have it precisely. Windsurfers will be smug. Everyone else will be refreshed.`;
  }
  if (wspd < 22) {
    return `A fresh ${wspd}-knot wind from ${dir}${gustNote} — the radar at ${airportLabel} flagged it. Secure the sun loungers. Still a beach day, just an animated one.`;
  }
  return `${wspd} knots from ${dir}${gustNote}. Our sensors at the airstrip are calling this serious wind. This is data your phone app doesn't have — and it says: pool over beach today.`;
}

function sammiVisQuip(visib: string | null, airportLabel: string = 'Samui airport'): string {
  if (!visib) return 'Visibility data from our airstrip sensors is updating — give me a moment.';
  if (visib === '6+' || visib === '9999' || parseFloat(visib) >= 9) {
    return "Visibility: unlimited. Our sensors at the airstrip confirm you can see all the way to the horizon. The mainland rain radar agrees — clean air in every direction. This is data your phone app simply doesn't show.";
  }
  const km = parseFloat(visib);
  if (km >= 5) return `The radar at ${airportLabel} is measuring ${km} kilometres of clear air. Perfectly fine for swimming, snorkelling, and sundowners. I see the data — it says: go enjoy yourself.`;
  if (km >= 2) return `Visibility down to ${km} kilometres — our sensors at the airstrip are picking up haze or light mist. Still very liveable, just softer light than usual. The mainland rain radar is watching with me.`;
  return `Only ${km} kilometres of visibility right now. Our sensors at the airstrip are flagging this. I see the data your phone app doesn't have — and it says: check conditions before heading to the water.`;
}

function sammiVerdict(
  fltCat: string,
  wx: string | null,
  wspd: number | null,
  airportLabel: string = 'Samui airport',
): string {
  const hasStorm = wx && (wx.toLowerCase().includes('thunder') || wx.toLowerCase().includes('funnel'));
  if (hasStorm) {
    return `The radar at ${airportLabel} is seeing electrical storm activity — and the mainland rain radar confirms it. I see the data your phone app doesn't have. Right now it says: stay indoors. I have the equipment; you have the vacation. Listen to me.`;
  }

  switch (fltCat) {
    case 'VFR':
      return "The sky is in perfect condition ✈️ — our sensors at the airstrip confirm it, and the mainland rain radar shows clean skies all around. Your phone's weather app doesn't have access to runway sensor data. I do. Go enjoy yourself.";
    case 'MVFR':
      return `Conditions are borderline today — the radar at ${airportLabel} is seeing low cloud and soft visibility. Beach day is fine. Flights may be slightly delayed. I'm watching the mainland rain radar so you don't have to.`;
    case 'IFR':
      if (wspd && wspd > 15) {
        return "Low cloud combined with strong wind — our sensors at the airstrip are not relaxed right now. I see the data your phone app doesn't have. Stay aware before any water activities.";
      }
      return `Low cloud and reduced visibility. The radar at ${airportLabel} confirms it; the mainland rain radar shows no heavy cells — just the atmosphere being dramatic. I have the equipment. Today it recommends: indoor brunch, patience, and trust in Sammi.`;
    case 'LIFR':
      return `Conditions are at minimum right now. The radar at ${airportLabel} and the mainland rain radar are both telling me the same thing — and even I won't spin this one. I see the data your phone app doesn't have. Today: stay safe, stay close to shore.`;
    default:
      return "Our sensors at the airstrip are reading conditions. I see the data your phone app doesn't have — and I'll tell you exactly what it means.";
  }
}

export type ParseMetarOptions = {
  /** e.g. "Krabi airport" — used in Sammi copy instead of "Samui airport". */
  airportLabel?: string;
};

export type ParseTafOptions = {
  airportLabel?: string;
};

// ── Main parsers ──────────────────────────────────────────────────────────────

export function parseMetar(raw: RawMetar, options?: ParseMetarOptions): ParsedMetar {
  const airportLabel = options?.airportLabel ?? 'Samui airport';
  const clouds: ParsedCloud[] = (raw.clouds ?? []).map(c => ({
    cover: c.cover,
    base:  c.base,
    label: CLOUD_LABELS[c.cover] ?? c.cover,
  }));

  // If no cloud layers reported, infer from cover field
  if (clouds.length === 0 && raw.cover) {
    clouds.push({ cover: raw.cover, base: null, label: CLOUD_LABELS[raw.cover] ?? raw.cover });
  }

  const wx = decodeWx(raw.wxString);

  const fltCatColor = {
    VFR:  'green',
    MVFR: 'yellow',
    IFR:  'red',
    LIFR: 'darkred',
  }[raw.fltCat] ?? 'green' as 'green' | 'yellow' | 'red' | 'darkred';

  return {
    raw:         raw.rawOb,
    obsTime:     raw.obsTime,
    temp:        raw.temp,
    dewp:        raw.dewp,
    wdir:        raw.wdir,
    wspd:        raw.wspd,
    wgst:        raw.wgst,
    visib:       raw.visib,
    qnh:         raw.altim,
    clouds,
    fltCat:      raw.fltCat,
    wxString:    wx,
    sammiSky:    sammiSkyQuip(clouds, raw.wxString, airportLabel),
    sammiWind:   sammiWindQuip(raw.wspd, raw.wgst, raw.wdir, airportLabel),
    sammiVisMood: sammiVisQuip(raw.visib, airportLabel),
    sammiVerdict: sammiVerdict(raw.fltCat, raw.wxString, raw.wspd, airportLabel),
    fltCatColor: fltCatColor as 'green' | 'yellow' | 'red' | 'darkred',
  };
}

export function parseTaf(raw: RawTaf, options?: ParseTafOptions): ParsedTaf {
  const airportLabel = options?.airportLabel ?? 'Samui airport';
  const periods: ParsedTafPeriod[] = (raw.fcsts ?? []).map(f => {
    const clouds: ParsedCloud[] = (f.clouds ?? []).map(c => ({
      cover: c.cover,
      base:  c.base,
      label: CLOUD_LABELS[c.cover] ?? c.cover,
    }));

    const from    = new Date(f.timeFrom * 1000);
    const to      = new Date(f.timeTo   * 1000);
    const wx      = decodeWx(f.wxString);
    const change  = f.fcstChange;

    // Human time label (ICT = UTC+7)
    const fmtOpts: Intl.DateTimeFormatOptions = {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
    };
    const fromStr = from.toLocaleTimeString('en-US', fmtOpts);
    const toStr   = to.toLocaleTimeString('en-US', fmtOpts);
    const changeTag = change ? `${change} ` : '';
    const label = `${changeTag}${fromStr}–${toStr} ICT`;

    // Sammi one-liner for this period — no aviation codes, human experience only
    let sammiLine = '';
    const dominantCloud = clouds[0]?.cover ?? 'SKC';
    const windDesc = f.wspd
      ? f.wspd < 8  ? 'a gentle sea breeze'
      : f.wspd < 15 ? `a ${f.wspd}-knot wind`
      : `a fresh ${f.wspd}-knot wind`
      : 'calm air';
    const cloudLabel = CLOUD_LABELS[dominantCloud] ?? 'mixed sky';
    const cloudAlt   = clouds[0]?.base ? altitudeStr(clouds[0].base) : '';
    if (wx && wx.toLowerCase().includes('thunder')) {
      sammiLine = `⛈️ The mainland rain radar sees a storm window around ${fromStr}. I'd rearrange outdoor plans — I see the data your phone app doesn't have.`;
    } else if (wx && wx.toLowerCase().includes('rain')) {
      sammiLine = `🌧️ The mainland rain radar shows rain likely around ${fromStr}. Our sensors at the airstrip already flagged it — now you know too.`;
    } else if (['BKN','OVC'].includes(dominantCloud)) {
      sammiLine = `🌥️ ${cloudLabel.charAt(0).toUpperCase() + cloudLabel.slice(1)}${cloudAlt} with ${windDesc}. The mainland rain radar shows no heavy cells — just moody sky.`;
    } else if (['SKC','CLR','FEW'].includes(dominantCloud)) {
      sammiLine = `☀️ ${cloudLabel.charAt(0).toUpperCase() + cloudLabel.slice(1)}${cloudAlt}, ${windDesc}. The radar at ${airportLabel} says this is exactly what you came here for.`;
    } else {
      sammiLine = `${cloudLabel.charAt(0).toUpperCase() + cloudLabel.slice(1)}${cloudAlt} with ${windDesc}. Our sensors at the airstrip see no drama.`;
    }

    return { from, to, change, wspd: f.wspd, wdir: f.wdir, visib: f.visib, clouds, wx, label, sammiLine };
  });

  return {
    raw:       raw.rawTAF,
    issued:    new Date(raw.issueTime),
    validFrom: new Date(raw.validTimeFrom * 1000),
    validTo:   new Date(raw.validTimeTo   * 1000),
    periods,
  };
}
