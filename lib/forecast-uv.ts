/**
 * UV index for stored Spire hours.
 * Spire wins when the point payload already has an index.
 * Otherwise the exact UTC hour from OpenUV's forecast is stored.
 * A missing hour stays null. Zero is kept when the source sent zero.
 */

const SPIRE_UV_KEYS = ['uv_index', 'ultraviolet_index', 'UV_index', 'surface_uv_index'] as const;

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Spire index, or null when those keys are absent. Does not turn a gap into zero. */
export function uvIndexFromSpireValues(values: Record<string, unknown> | null | undefined): number | null {
  if (!values) return null;
  for (const key of SPIRE_UV_KEYS) {
    const raw = values[key];
    if (!finite(raw) || raw < 0 || raw > 25) continue;
    return Math.round(raw * 10) / 10;
  }
  return null;
}

function utcHourBucketMs(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor(t / 3_600_000) * 3_600_000;
}

function collectOpenUvRows(node: unknown, out: { uv: number; uvTime: string }[]): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) collectOpenUvRows(item, out);
    return;
  }
  if (typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  const uvTime =
    typeof record.uv_time === 'string'
      ? record.uv_time
      : typeof record.time === 'string'
        ? record.time
        : null;
  if (finite(record.uv) && record.uv >= 0 && record.uv <= 25 && uvTime) {
    out.push({ uv: record.uv, uvTime });
    return;
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      collectOpenUvRows(value, out);
    }
  }
}

/** Exact UTC hour only. A neighbouring hour is not copied onto a gap. */
export function openUvExactHourMap(payload: unknown): Map<number, number> {
  const rows: { uv: number; uvTime: string }[] = [];
  collectOpenUvRows(payload, rows);
  const map = new Map<number, number>();
  for (const row of rows) {
    const bucket = utcHourBucketMs(row.uvTime);
    if (bucket == null) continue;
    map.set(bucket, Math.round(row.uv * 10) / 10);
  }
  return map;
}

export async function fetchOpenUvHourMap(
  lat: number,
  lon: number,
): Promise<Map<number, number> | null> {
  const key = process.env.NEXT_PUBLIC_OPENUV_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.openuv.io/api/v1/forecast?lat=${lat}&lng=${lon}&alt=0`,
      {
        headers: { 'x-access-token': key },
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!res.ok) {
      console.error(`[weather-ingest] OpenUV status ${res.status}`);
      return null;
    }
    return openUvExactHourMap(await res.json());
  } catch (err) {
    console.error('[weather-ingest] OpenUV forecast failed', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fill `uv_index` on a flattened forecast row.
 * Spire's own index is left as-is. OpenUV fills only a null index on an exact hour.
 */
export function stampUvIndex(
  flat: Record<string, unknown>,
  openUvHours: Map<number, number> | null,
): void {
  const values =
    flat.values_json && typeof flat.values_json === 'object'
      ? { ...(flat.values_json as Record<string, unknown>) }
      : {};
  const fromSpire = uvIndexFromSpireValues(values);
  if (fromSpire != null) {
    flat.uv_index = fromSpire;
    flat.values_json = { ...values, uv_index: fromSpire, uv_index_source: 'spire' };
    return;
  }
  const valid = typeof flat.valid_time_utc === 'string' ? flat.valid_time_utc : '';
  const bucket = valid ? utcHourBucketMs(valid) : null;
  const fromOpenUv = bucket != null && openUvHours ? openUvHours.get(bucket) : undefined;
  if (fromOpenUv == null) {
    flat.uv_index = null;
    flat.values_json = values;
    return;
  }
  flat.uv_index = fromOpenUv;
  flat.values_json = { ...values, uv_index: fromOpenUv, uv_index_source: 'openuv' };
}
