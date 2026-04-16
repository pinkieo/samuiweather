/** Vakantie-/strandlogica: advies op basis van Spire-waarden (kts, UV, mm/h). */

export type BeachAdvice = {
  label: string;
  color: string;
  msg: string;
};

/** `wind` in knopen, `uv` UV-index (null als niet beschikbaar), `rainMmH` neerslagtempo mm/h. */
export function getBeachAdvice(
  wind: number,
  uv: number | null | undefined,
  rainMmH: number,
  temp: number,
): BeachAdvice {
  if (rainMmH > 0.5) {
    return {
      label: 'Regenkap',
      color: 'text-blue-400',
      msg: 'Tropische bui verwacht',
    };
  }
  if (wind > 15) {
    return {
      label: 'Hoge golven',
      color: 'text-orange-400',
      msg: 'Rode vlag op Chaweng?',
    };
  }
  if ((uv != null && uv > 10) || temp > 34) {
    return {
      label: 'Gevaarlijk heet',
      color: 'text-rose-500',
      msg: 'Pas op: Extreem heet. Zoek de schaduw op!',
    };
  }
  if (uv != null && uv > 8) {
    return {
      label: 'Factor 50+',
      color: 'text-rose-500',
      msg: 'Extreem sterke zon',
    };
  }
  return {
    label: 'Top stranddag',
    color: 'text-emerald-400',
    msg: 'Perfect voor Silver Beach',
  };
}

export function getUVBadge(uv: number | null | undefined): {
  text: string;
  tone: string;
} {
  if (uv == null || Number.isNaN(uv)) {
    return { text: '—', tone: 'text-slate-500' };
  }
  if (uv >= 11) return { text: 'Extreme', tone: 'text-rose-500' };
  if (uv >= 8) return { text: 'Very high', tone: 'text-rose-500' };
  if (uv >= 6) return { text: 'High', tone: 'text-amber-400' };
  if (uv >= 3) return { text: 'Mod', tone: 'text-yellow-400' };
  return { text: 'Low', tone: 'text-emerald-400' };
}

const DIR_ABBR = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
type DirAbbr = (typeof DIR_ABBR)[number];

const DIR_NAMES: Record<DirAbbr, string> = {
  N:  'the North',
  NE: 'the Northeast',
  E:  'the East',
  SE: 'the Southeast',
  S:  'the South',
  SW: 'the Southwest',
  W:  'the West',
  NW: 'the Northwest',
};

/**
 * Wind from N/NE/E/SE → those coasts get choppy → sheltered: West & South.
 * Wind from S/SW/W/NW → those coasts get choppy → sheltered: East & North.
 */
function shelteredForDir(dir: DirAbbr) {
  if (['N', 'NE', 'E', 'SE'].includes(dir)) {
    return {
      coast: 'West & South Coast',
      beaches: 'Lipa Noi or Taling Ngam',
    };
  }
  return {
    coast: 'East & North Coast',
    beaches: 'Chaweng, Lamai or Bophut',
  };
}

function windStrengthLabel(kts: number): string {
  if (kts < 5)  return 'light';
  if (kts < 12) return 'moderate';
  if (kts < 20) return 'fresh';
  return 'strong';
}

export function getWindInfo(degrees: number) {
  const index = Math.round(((degrees % 360) + 360) % 360 / 45) % 8;
  const dir = DIR_ABBR[index];
  return { dir, dirName: DIR_NAMES[dir], sheltered: shelteredForDir(dir) };
}

/**
 * Returns a single clean English sentence for the Beach Guide card.
 */
export function getBeachGuideSentence(
  degrees: number,
  windKts: number,
  isDay: boolean,
  isGoldenHour: boolean,
  condition: 'rain' | 'choppy' | 'calm',
): string {
  const { dirName, sheltered } = getWindInfo(degrees);
  const strength = windStrengthLabel(windKts);

  if (!isDay) {
    const occasion = isGoldenHour ? 'sunset dinner' : 'evening dinner';
    return `A ${strength} breeze from ${dirName}. Head to the ${sheltered.coast} for a perfectly calm ${occasion}.`;
  }

  if (condition === 'rain') {
    return `Brief showers expected. If the rain clears, the calmest water will be on the ${sheltered.coast} — try ${sheltered.beaches}.`;
  }
  if (condition === 'choppy') {
    return `Breezy today. The water is calmest on the ${sheltered.coast} — ${sheltered.beaches} is your best bet.`;
  }
  return `Calm conditions. The water is calmest today on the ${sheltered.coast} — head to ${sheltered.beaches}.`;
}

/** PM2.5 in µg/m³ (ruwe WHO-richtlijnen). */
export function getPM25Badge(ugm3: number | null | undefined): {
  text: string;
  tone: string;
} {
  if (ugm3 == null || Number.isNaN(ugm3)) {
    return { text: '—', tone: 'text-slate-500' };
  }
  if (ugm3 <= 12) return { text: 'Good', tone: 'text-emerald-400' };
  if (ugm3 <= 35) return { text: 'Fair', tone: 'text-lime-400' };
  if (ugm3 <= 55) return { text: 'Moderate', tone: 'text-amber-400' };
  if (ugm3 <= 150) return { text: 'Poor', tone: 'text-orange-400' };
  return { text: 'Hazardous', tone: 'text-rose-500' };
}

/** RainViewer gebruikt 10-minuten Unix-tijdstempels (seconden). */
export function radarTimestampFromForecastIso(validTimeIso: string): number {
  const ms = Date.parse(validTimeIso);
  if (Number.isNaN(ms)) {
    return Math.floor(Date.now() / 1000 / 600) * 600;
  }
  return Math.floor(ms / 1000 / 600) * 600;
}
