import { NextResponse } from 'next/server';
import {
  VTSM_METAR_URL, VTSM_TAF_URL,
  parseMetar, parseTaf,
  type RawMetar, type RawTaf, type ParsedMetar, type ParsedTaf,
} from '@/lib/metar';
import { metarFreshness, type SourceFreshness } from '@/lib/data-freshness';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

export interface MetarApiResponse {
  metar:     ParsedMetar    | null;
  taf:       ParsedTaf      | null;
  freshness: SourceFreshness | null;
  fetchedAt: number;          // Unix seconds — when this API call ran
  error?: string;
}

export async function GET() {
  try {
    const [metarRes, tafRes] = await Promise.allSettled([
      fetch(VTSM_METAR_URL, { next: { revalidate: 300 } }),
      fetch(VTSM_TAF_URL,   { next: { revalidate: 300 } }),
    ]);

    // ── METAR ────────────────────────────────────────────────────────────────
    let metar: ParsedMetar | null = null;
    if (metarRes.status === 'fulfilled' && metarRes.value.ok) {
      const raw: RawMetar[] = await metarRes.value.json();
      if (raw.length > 0) metar = parseMetar(raw[0]);
    }

    // ── TAF ──────────────────────────────────────────────────────────────────
    let taf: ParsedTaf | null = null;
    if (tafRes.status === 'fulfilled' && tafRes.value.ok) {
      const raw: RawTaf[] = await tafRes.value.json();
      if (raw.length > 0) taf = parseTaf(raw[0]);
    }

    const freshness = metar ? metarFreshness(metar.obsTime) : null;

    return NextResponse.json({
      metar,
      taf,
      freshness,
      fetchedAt: Math.floor(Date.now() / 1000),
    } satisfies MetarApiResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ metar: null, taf: null, freshness: null, fetchedAt: Math.floor(Date.now() / 1000), error: message }, { status: 500 });
  }
}
