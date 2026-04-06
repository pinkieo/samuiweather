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
