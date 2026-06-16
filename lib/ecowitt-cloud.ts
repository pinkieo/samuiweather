/**
 * Poll Ecowitt Cloud API (api.ecowitt.net) when the GW1100 uploads to Ecowitt.net
 * but custom-server push to our ingest URL is not configured.
 *
 * Keys: https://api.ecowitt.net → Private Center → Application Key + API Key + device MAC.
 */
import type { EcowittPayload } from './ecowitt-payload';
import { upsertEcowittObservation, type UpsertEcowittResult } from './ecowitt-store';

type MetricField = { time?: string; unit?: string; value?: string };

function fieldValue(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const v = (node as MetricField).value;
  return v != null && String(v).trim() !== '' ? String(v) : null;
}

function fieldTime(node: unknown): number | null {
  if (!node || typeof node !== 'object') return null;
  const t = (node as MetricField).time;
  if (t == null || String(t).trim() === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function pickGroup(data: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const g = data[key];
  return g && typeof g === 'object' ? (g as Record<string, unknown>) : null;
}

/** Map Ecowitt Cloud `real_time` JSON → custom-upload shaped payload for shared normalizer. */
export function cloudJsonToPayload(json: unknown): EcowittPayload | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as { code?: number; data?: Record<string, unknown> };
  if (root.code !== 0 || !root.data) return null;

  const data = root.data;
  const outdoor = pickGroup(data, 'outdoor');
  const indoor = pickGroup(data, 'indoor');
  const wind = pickGroup(data, 'wind');
  const pressure = pickGroup(data, 'pressure');
  const rainfall = pickGroup(data, 'rainfall') ?? pickGroup(data, 'rainfall_piezo');
  const solar = pickGroup(data, 'solar_and_uvi');

  let latestUnix = 0;
  const considerTime = (node: unknown) => {
    const t = fieldTime(node);
    if (t != null && t > latestUnix) latestUnix = t;
  };

  for (const group of [outdoor, indoor, wind, pressure, rainfall, solar]) {
    if (!group) continue;
    for (const v of Object.values(group)) considerTime(v);
  }

  const payload: EcowittPayload = {
    stationtype: 'ecowitt-cloud',
    source: 'ecowitt-cloud-api',
  };

  if (latestUnix > 0) {
    payload.dateutc = new Date(latestUnix * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  }

  const outTemp = outdoor ? fieldValue(outdoor.temperature) : null;
  const outHum = outdoor ? fieldValue(outdoor.humidity) : null;
  const inTemp = indoor ? fieldValue(indoor.temperature) : null;
  const inHum = indoor ? fieldValue(indoor.humidity) : null;

  // Cloud API returns °C when temp_unitid=1
  if (outTemp != null) {
    const c = Number(outTemp);
    if (Number.isFinite(c)) payload.tempf = String((c * 9) / 5 + 32);
  }
  if (outHum != null) payload.humidity = outHum;
  if (inTemp != null) {
    const c = Number(inTemp);
    if (Number.isFinite(c)) payload.indoortempf = String((c * 9) / 5 + 32);
  }
  if (inHum != null) payload.indoorhumidity = inHum;

  if (wind) {
    const ws = fieldValue(wind.wind_speed);
    const wg = fieldValue(wind.wind_gust);
    const wd = fieldValue(wind.wind_direction);
    // wind_speed_unitid=6 → m/s; convert to mph for shared normalizer
    if (ws != null) {
      const ms = Number(ws);
      if (Number.isFinite(ms)) payload.windspeedmph = String(ms / 0.44704);
    }
    if (wg != null) {
      const ms = Number(wg);
      if (Number.isFinite(ms)) payload.windgustmph = String(ms / 0.44704);
    }
    if (wd != null) payload.winddir = wd;
  }

  if (pressure) {
    const rel = fieldValue(pressure.relative);
    const abs = fieldValue(pressure.absolute);
    // pressure_unitid=3 → hPa; convert to inHg
    if (rel != null) {
      const hpa = Number(rel);
      if (Number.isFinite(hpa)) payload.baromrelin = String(hpa / 33.8638866667);
    }
    if (abs != null) {
      const hpa = Number(abs);
      if (Number.isFinite(hpa)) payload.baromabsin = String(hpa / 33.8638866667);
    }
  }

  if (rainfall) {
    const rate = fieldValue(rainfall.rain_rate);
    const hour = fieldValue(rainfall.hourly);
    const day = fieldValue(rainfall.daily);
    // rainfall_unitid=12 → mm
    if (rate != null) {
      const mmh = Number(rate);
      if (Number.isFinite(mmh)) payload.rainratein = String(mmh / 25.4);
    }
    if (hour != null) {
      const mm = Number(hour);
      if (Number.isFinite(mm)) payload.hourlyrainin = String(mm / 25.4);
    }
    if (day != null) {
      const mm = Number(day);
      if (Number.isFinite(mm)) payload.dailyrainin = String(mm / 25.4);
    }
  }

  if (solar) {
    const sol = fieldValue(solar.solar);
    const uv = fieldValue(solar.uvi);
    if (sol != null) payload.solarradiation = sol;
    if (uv != null) payload.uv = uv;
  }

  if (!payload.tempf && !payload.humidity && !payload.windspeedmph) return null;
  return payload;
}

export type SyncEcowittCloudResult =
  | { ok: true; observedAt: string; id: string; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export async function syncEcowittFromCloud(): Promise<SyncEcowittCloudResult> {
  const applicationKey = process.env.ECOWITT_APPLICATION_KEY?.trim();
  const apiKey = process.env.ECOWITT_API_KEY?.trim();
  const mac = process.env.ECOWITT_MAC?.trim();

  if (!applicationKey || !apiKey || !mac) {
    return {
      ok: true,
      skipped: true,
      reason: 'ECOWITT_APPLICATION_KEY, ECOWITT_API_KEY, or ECOWITT_MAC not set',
    };
  }

  const params = new URLSearchParams({
    application_key: applicationKey,
    api_key: apiKey,
    mac,
    call_back: 'all',
    temp_unitid: '1',
    pressure_unitid: '3',
    wind_speed_unitid: '6',
    rainfall_unitid: '12',
    solar_irradiance_unitid: '16',
  });

  const url = `https://api.ecowitt.net/api/v3/device/real_time?${params}`;
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    return { ok: false, error: `Ecowitt Cloud: ${msg}` };
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: `Ecowitt Cloud HTTP ${res.status}` };
  }

  const payload = cloudJsonToPayload(json);
  if (!payload) {
    const code = (json as { code?: number; msg?: string } | null)?.code;
    const msg = (json as { msg?: string } | null)?.msg;
    return { ok: false, error: `Ecowitt Cloud parse failed (code=${code ?? '?'} ${msg ?? ''})` };
  }

  const result: UpsertEcowittResult = await upsertEcowittObservation(payload);
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, id: result.id, observedAt: result.observedAt };
}
