/**
 * Blend Spire model cloud % with airport METAR + UV — tropics often show “cloudy” while METAR/UV say sunny.
 */

export type MetarDominantCover =
  | 'CLR'
  | 'SKC'
  | 'FEW'
  | 'SCT'
  | 'BKN'
  | 'OVC'
  | null;

export function dominantCoverFromMetarClouds(
  clouds: { cover: string }[] | null | undefined,
): MetarDominantCover {
  if (!clouds?.length) return null;
  const c = String(clouds[0]?.cover ?? '').toUpperCase();
  if (c === 'CLR' || c === 'SKC' || c === 'FEW' || c === 'SCT' || c === 'BKN' || c === 'OVC') {
    return c;
  }
  return null;
}

export function effectiveCloudCoverDisplay(
  modelPct: number,
  uvIndex: number | null,
  metarSky: MetarDominantCover,
): { pct: number; note: string } {
  const m = metarSky;
  if (m === 'CLR' || m === 'SKC') {
    return {
      pct: Math.min(modelPct, 8),
      note: ' · airport METAR clear (model can still show haze aloft)',
    };
  }
  if (m === 'FEW') {
    return {
      pct: Math.min(modelPct, 30),
      note: ' · METAR few clouds',
    };
  }
  if (m === 'SCT' && modelPct > 65) {
    return {
      pct: Math.min(modelPct, 52),
      note: ' · METAR scattered',
    };
  }

  let p = modelPct;
  let note = '';
  if (uvIndex != null && uvIndex >= 7 && p > 35) {
    p = Math.round(p * 0.62);
    note = ' · UV high — model may overstate cloud in the tropics';
  }
  return { pct: Math.min(100, p), note };
}
