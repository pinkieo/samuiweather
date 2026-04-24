/**
 * Spire’s `basic` bundle often exposes only `total_cloud_cover` (full column) — so you can see “100%” while
 * low cloud is sparse. With the **`clouds`** bundle (when your token allows it) you get
 * low/mid/high; some bundles expose `effective_cloud_cover` (effect on sun at ground level).
 *
 * @see https://developers.wx.spire.com/bundles — Clouds bundle (`clouds`)
 */

export type SpireCloudLayerInputs = {
  /** Effect on shortwave radiation / “feels like” cloud at the surface (0–100). */
  effectiveCloudCover: number | null;
  /** Full atmosphere column (0–100) — raw Spire field. */
  totalCloudCover: number | null;
  lowCloudCover: number | null;
  midCloudCover: number | null;
  highCloudCover: number | null;
};

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Spire sometimes returns fractions (0–1) instead of percent. */
function toPercent0to100(v: number | null): number | null {
  if (v == null || Number.isNaN(v)) return null;
  if (v >= 0 && v <= 1) return v * 100;
  return v;
}

/**
 * Weights: low = what you see at the beach; high = cirrus/veil — little effect on “feels sunny”.
 * (Tunable; bundle docs: low &lt; ~650 hPa, high &gt; ~350 hPa top.)
 */
const W_LOW = 0.82;
const W_MID = 0.32;
const W_HIGH = 0.09;

/**
 * Single number for dashboard / Sammi: beach-relevant cloud cover (0–100).
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
 * Fields from Spire `values{}` — several possible API names for future bundles.
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
