/**
 * Server-only: one call to the Meteoblue 1h package (same as `/api/meteoblue/point`).
 * Shared by that route and the validation cron — no UI branding, data only.
 */
import type { ReferenceNowcastSnapshot } from './forecast-reference';

type MbErr = {
  ok: false;
  enabled: true;
  error: string;
  /** Meteoblue HTTP status when `!res.ok` — use 502 in API, not 500. */
  upstreamStatus?: number;
  /** First ~200 chars of body (do not leak keys in client responses). */
  upstreamBodySnippet?: string;
};

type MbResult =
  | { ok: true; enabled: true; snapshot: ReferenceNowcastSnapshot }
  | { ok: false; enabled: false; error: string }
  | MbErr;

export async function fetchMeteobluePointSnapshot(
  lat: number,
  lon: number,
  asl?: number,
  signal?: AbortSignal,
): Promise<MbResult> {
  const apiKey = process.env.METEOBLUE_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, enabled: false, error: 'METEOBLUE_API_KEY not configured' };
  }

  const aslN =
    asl != null && Number.isFinite(asl)
      ? asl
      : Number(process.env.METEOBLUE_ASL ?? '5');
  const aslStr = Number.isFinite(aslN) ? String(aslN) : '5';
  const url = `https://my.meteoblue.com/packages/basic-1h_clouds-1h_sunmoon?apikey=${apiKey}&lat=${lat}&lon=${lon}&asl=${aslStr}&format=json&tz=Asia%2FBangkok`;

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal,
      headers: { 'User-Agent': 'SamuiWeather/1.0 (point snapshot)' },
    });
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let raw: any;
    try {
      raw = text ? JSON.parse(text) : {};
    } catch {
      return {
        ok: false,
        enabled: true,
        error: 'meteoblue non-json response',
        upstreamStatus: res.status,
        upstreamBodySnippet: text.slice(0, 200),
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        enabled: true,
        error: 'meteoblue http error',
        upstreamStatus: res.status,
        upstreamBodySnippet: text.slice(0, 200),
      };
    }

    const d1h = raw.data_1h;
    if (!d1h?.time || !Array.isArray(d1h.time) || d1h.time.length === 0) {
      return {
        ok: false,
        enabled: true,
        error: 'unexpected meteoblue shape (data_1h.time)',
        upstreamBodySnippet: text.slice(0, 200),
      };
    }

    const times = d1h.time as string[];
    const now = Date.now();
    let bestI = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const s = times[i]!;
      const tMs = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
      if (Number.isNaN(tMs)) continue;
      const diff = Math.abs(tMs - now);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestI = i;
      }
    }
    if (bestDiff === Infinity) {
      bestI = 0;
    }

    const i = bestI;
    const tempC = d1h.temperature?.[i] ?? d1h.t_2m?.[i] ?? null;
    const windKmh = Number(
      d1h.windspeed?.[i] ?? d1h.wind_speed?.[i] ?? d1h.windspeed_mean_10m?.[i] ?? 0,
    );
    const windDir = Number(d1h.winddirection?.[i] ?? d1h.wind_direction?.[i] ?? 0);
    const precipMm = Number(
      d1h.precipitation?.[i] ?? d1h.precipitation_total?.[i] ?? 0,
    );
    const windSpeedMs = Number.isFinite(windKmh) ? windKmh / 3.6 : 0;

    const snapshot: ReferenceNowcastSnapshot = {
      tempC:
        typeof tempC === 'number' && Number.isFinite(tempC)
          ? Math.round(tempC * 10) / 10
          : null,
      windSpeedMs:
        Math.round((Number.isFinite(windSpeedMs) ? windSpeedMs : 0) * 100) / 100,
      windDirDeg: (Math.round(Number.isFinite(windDir) ? windDir : 0) + 360) % 360,
      precipMm: Math.round((Number.isFinite(precipMm) ? precipMm : 0) * 100) / 100,
    };

    return { ok: true, enabled: true, snapshot };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, enabled: true, error: 'aborted' };
    }
    return {
      ok: false,
      enabled: true,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}
