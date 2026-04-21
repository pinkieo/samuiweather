/**
 * Spire levert in `basic` vaak alleen `total_cloud_cover` (hele kolom) — daardoor “100%” terwijl
 * laaghangende bewolking schaars is. Met de **`clouds`** bundle (als je token die toestaat) krijg je
 * low/mid/high; sommige bundels leveren `effective_cloud_cover` (effect op zon op de grond).
 *
 * @see https://developers.wx.spire.com/bundles — Clouds bundle (`clouds`)
 */

export type SpireCloudLayerInputs = {
  /** Effect op kortgolvige straling / “voelt” als bewolking op maaiveld (0–100). */
  effectiveCloudCover: number | null;
  /** Hele atmosfeer-kolom (0–100) — ruw Spire-veld. */
  totalCloudCover: number | null;
  lowCloudCover: number | null;
  midCloudCover: number | null;
  highCloudCover: number | null;
};

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Spire geeft soms fracties (0–1) i.p.v. procenten. */
function toPercent0to100(v: number | null): number | null {
  if (v == null || Number.isNaN(v)) return null;
  if (v >= 0 && v <= 1) return v * 100;
  return v;
}

/**
 * Gewichten: laag = wat je op het strand ziet; hoog = cirrus/sluier — weinig invloed op “zonnetje”.
 * (Afstembaar; documentatie in bundels: low &lt; ~650 hPa, high &gt; ~350 hPa top.)
 */
const W_LOW = 0.82;
const W_MID = 0.32;
const W_HIGH = 0.09;

/**
 * Eén getal voor dashboard / Sammi: strand-relevante bewolking (0–100).
 */
export function computeSpireBeachSkyCloudCover(
  layers: SpireCloudLayerInputs,
): number {
  const eff = toPercent0to100(layers.effectiveCloudCover);
  if (eff != null) {
    return clampPct(eff);
  }

  const hasLayer =
    layers.lowCloudCover != null ||
    layers.midCloudCover != null ||
    layers.highCloudCover != null;

  if (hasLayer) {
    const low = toPercent0to100(layers.lowCloudCover);
    const mid = toPercent0to100(layers.midCloudCover);
    const high = toPercent0to100(layers.highCloudCover);
    const L = low ?? 0;
    const M = mid ?? 0;
    const H = high ?? 0;
    return clampPct(W_LOW * L + W_MID * M + W_HIGH * H);
  }

  const total = toPercent0to100(layers.totalCloudCover) ?? 0;
  return clampPct(total);
}

/**
 * Velden uit Spire `values{}` — meerdere mogelijke API-namen voor toekomstige bundels.
 */
export function extractSpireCloudLayerInputs(
  vr: Record<string, unknown>,
): SpireCloudLayerInputs {
  const pick = (keys: string[]): number | null => {
    for (const k of keys) {
      const x = vr[k];
      if (typeof x === 'number' && !Number.isNaN(x)) return x;
    }
    return null;
  };

  return {
    effectiveCloudCover: pick([
      'effective_cloud_cover',
      'effective_cloud_cover_at_surface',
    ]),
    totalCloudCover: pick(['total_cloud_cover', 'cloud_cover']),
    lowCloudCover: pick([
      'low_cloud_cover',
      'cloud_cover_low',
      'low_level_cloud_cover',
    ]),
    midCloudCover: pick([
      'medium_cloud_cover',
      'mid_cloud_cover',
      'cloud_cover_mid',
      'mid_level_cloud_cover',
    ]),
    highCloudCover: pick([
      'high_cloud_cover',
      'cloud_cover_high',
      'high_level_cloud_cover',
    ]),
  };
}
