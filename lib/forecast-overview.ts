/**
 * 4× daily Spire+OPF overview: lock ICT slots to weather_forecast_snapshot,
 * tourist copy, and raw Ecowitt comparison (no invented wet/dry call).
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  ECOWITT_LOCATION_ID,
  ECOWITT_TIME_ZONE,
  type EcowittDaySample,
  fetchEcowittDaily,
  fetchEcowittRange,
  fetchLatestEcowittObservation,
  ictDayUtcRange,
  ictYmd,
  parseIctDateYmd,
} from '@/lib/ecowitt-data';
import { SPIRE_LOCATION_ID } from '@/lib/forecast-day-accuracy';

export const OVERVIEW_SLOTS = ['0000', '0600', '1200', '1800'] as const;
export type OverviewSlot = (typeof OVERVIEW_SLOTS)[number];

export const SLOT_LABEL: Record<OverviewSlot, string> = {
  '0000': 'Night / overnight',
  '0600': 'Morning lock',
  '1200': 'Midday update',
  '1800': 'Evening update',
};

export const RAIN_SKILL_NOTE =
  'Spire temperature is usually close at Baan Ton Kluay. Rain millimetres are uncalibrated: dry days are over-called and the total is often about double the station. Numbers below are raw — no wet/dry cutoff.';

export const SLOT_LOCK_TABLE = 'daily_forecast_slot_lock';

export type SlotLockRecord = {
  locationId: string;
  date: string;
  slot: OverviewSlot;
  issuanceTimeUtc: string;
  retrievedAtUtc: string | null;
  forecastJson: Record<string, unknown>;
  verificationJson: SlotAccuracy | null;
};

/** First lock wins the forecast blob. A second write of the same slot never duplicates; it may only attach verification. */
export function applyLockOnce(
  existing: SlotLockRecord | null,
  incoming: SlotLockRecord,
): { record: SlotLockRecord; duplicated: boolean } {
  if (!existing) return { record: incoming, duplicated: false };
  return {
    duplicated: true,
    record: {
      ...existing,
      verificationJson: incoming.verificationJson ?? existing.verificationJson,
    },
  };
}

const LOOKAHEAD_H = 12;
const ISSUANCE_BEFORE_MS = 45 * 60 * 1000;
const ISSUANCE_AFTER_MS = 90 * 60 * 1000;

export type OverviewHour = {
  validTimeUtc: string;
  leadHours: number | null;
  tempC: number | null;
  humidityPct: number | null;
  windMs: number | null;
  precipRate: number | null;
  pop1h: number | null;
  pop24h: number | null;
  thunderPct: number | null;
  fogPct: number | null;
  opfOverlayApplied: boolean;
};

export type TouristPeriod = {
  label: string;
  hourRange: string;
  text: string;
  rainChancePct: number | null;
  tempBandC: string;
};

export type SlotAccuracy = {
  windowStartUtc: string;
  windowEndUtc: string;
  stationSampleCount: number;
  stationTempMinC: number | null;
  stationTempMaxC: number | null;
  stationTempMeanC: number | null;
  forecastTempMinC: number | null;
  forecastTempMaxC: number | null;
  forecastTempMeanC: number | null;
  tempMeanErrorC: number | null;
  stationRainDeltaMm: number | null;
  stationRainRateMaxMmh: number | null;
  stationRainDayMmEnd: number | null;
  forecastPrecipSumMm: number | null;
  forecastPop1hMeanPct: number | null;
  forecastPop1hMaxPct: number | null;
  forecastThunderMeanPct: number | null;
  thunderObservable: false;
  rainSkillNote: string;
};

export type OverviewSlotView = {
  date: string;
  slot: OverviewSlot;
  label: string;
  slotStartIct: string;
  locked: boolean;
  liveFallback: boolean;
  locationId: string;
  issuanceTimeUtc: string | null;
  retrievedAtUtc: string | null;
  opfOverlayApplied: boolean;
  sourceComposition: unknown;
  leadHoursMin: number | null;
  leadHoursMax: number | null;
  hourCount: number;
  tempMinC: number | null;
  tempMaxC: number | null;
  pop1hMeanPct: number | null;
  pop1hMaxPct: number | null;
  thunderMaxPct: number | null;
  fogMaxPct: number | null;
  precipSumMm: number | null;
  windMaxMs: number | null;
  tourist: { headline: string; periods: TouristPeriod[] };
  hours: OverviewHour[];
  accuracy: SlotAccuracy | null;
};

export type ForecastOverview = {
  timezone: typeof ECOWITT_TIME_ZONE;
  locationId: string;
  stationLocationId: string;
  generatedAt: string;
  current: { date: string; slot: OverviewSlot };
  previous: { date: string; slot: OverviewSlot };
  slots: OverviewSlotView[];
  previousAccuracy: SlotAccuracy | null;
  rollingDay: {
    date: string;
    stationRainDayMm: number | null;
    stationTempMinC: number | null;
    stationTempMaxC: number | null;
    stationSampleCount: number;
    complete: boolean;
  };
  now: {
    tempC: number | null;
    rainRateMmh: number | null;
    rainDayMm: number | null;
    observedAt: string | null;
  } | null;
  rainSkillNote: string;
};

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 1000) / 1000;
}

function minNum(values: number[]): number | null {
  return values.length ? Math.min(...values) : null;
}

function maxNum(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

function round3(v: number | null): number | null {
  return v == null ? null : Math.round(v * 1000) / 1000;
}

function hourIct(iso: string): number {
  const h = new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: ECOWITT_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  return parseInt(h, 10) || 0;
}

export function parseOverviewSlot(raw: string | null | undefined): OverviewSlot | null {
  const s = String(raw || '').replace(':', '').padStart(4, '0');
  return (OVERVIEW_SLOTS as readonly string[]).includes(s) ? (s as OverviewSlot) : null;
}

export function currentOverviewSlot(at = new Date()): { date: string; slot: OverviewSlot } {
  const date = ictYmd(at);
  const hour = parseInt(
    at.toLocaleTimeString('en-GB', {
      timeZone: ECOWITT_TIME_ZONE,
      hour: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }),
    10,
  );
  if (hour >= 18) return { date, slot: '1800' };
  if (hour >= 12) return { date, slot: '1200' };
  if (hour >= 6) return { date, slot: '0600' };
  return { date, slot: '0000' };
}

export function nextOverviewSlot(date: string, slot: OverviewSlot): { date: string; slot: OverviewSlot } {
  const i = OVERVIEW_SLOTS.indexOf(slot);
  if (i === OVERVIEW_SLOTS.length - 1) {
    const noon = new Date(`${date}T12:00:00+07:00`);
    return { date: ictYmd(new Date(noon.getTime() + 24 * 3600 * 1000)), slot: '0000' };
  }
  return { date, slot: OVERVIEW_SLOTS[i + 1]! };
}

export function previousOverviewSlot(
  date: string,
  slot: OverviewSlot,
): { date: string; slot: OverviewSlot } {
  const i = OVERVIEW_SLOTS.indexOf(slot);
  if (i <= 0) {
    const noon = new Date(`${date}T12:00:00+07:00`);
    return { date: ictYmd(new Date(noon.getTime() - 24 * 3600 * 1000)), slot: '1800' };
  }
  return { date, slot: OVERVIEW_SLOTS[i - 1]! };
}

export function slotStartUtc(date: string, slot: OverviewSlot): Date {
  const hh = `${slot.slice(0, 2)}:${slot.slice(2)}`;
  return new Date(`${date}T${hh}:00+07:00`);
}

export function slotEndUtc(date: string, slot: OverviewSlot): Date {
  const next = nextOverviewSlot(date, slot);
  return slotStartUtc(next.date, next.slot);
}

/** Station daily-rain counter delta across a window (handles ICT midnight reset). */
export function rainCounterDelta(samples: EcowittDaySample[]): number | null {
  if (!samples.length) return null;
  const ordered = [...samples].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const byDay = new Map<string, number[]>();
  for (const row of ordered) {
    if (!finite(row.rain_day_mm)) continue;
    const day = ictYmd(new Date(row.observed_at));
    const list = byDay.get(day) || [];
    list.push(row.rain_day_mm);
    byDay.set(day, list);
  }
  let sum = 0;
  let any = false;
  for (const values of byDay.values()) {
    const first = values[0]!;
    const peak = Math.max(...values);
    const delta = Math.max(0, peak - Math.min(first, peak));
    sum += delta;
    any = true;
  }
  return any ? round3(sum) : null;
}

export function touristSummary(hours: OverviewHour[], slot: OverviewSlot): {
  headline: string;
  periods: TouristPeriod[];
} {
  if (!hours.length) {
    return {
      headline: 'No locked hours for this slot yet.',
      periods: [],
    };
  }
  const pops = hours.map((h) => h.pop1h).filter(finite);
  const temps = hours.map((h) => h.tempC).filter(finite);
  const rain = hours.map((h) => h.precipRate).filter(finite);
  const meanPop = mean(pops);
  const tmin = minNum(temps);
  const tmax = maxNum(temps);
  const maxRain = maxNum(rain) ?? 0;
  let headline = 'Next hours look workable outdoors.';
  if (meanPop != null && meanPop >= 50 && maxRain >= 0.4) {
    headline = 'Keep cover handy — rain chance is high in the next hours.';
  } else if (meanPop != null && meanPop >= 35) {
    headline = 'Flexible plans — some rain possible, not a washout on the numbers.';
  } else if (tmin != null && tmax != null) {
    headline = `Air ${Math.round(tmin)}–${Math.round(tmax)}°C. Rain chance stays modest on this issuance.`;
  }

  const bands: { label: string; start: number; end: number }[] =
    slot === '1800' || slot === '0000'
      ? [
          { label: 'Evening', start: 18, end: 22 },
          { label: 'Overnight', start: 22, end: 24 },
          { label: 'Early morning', start: 0, end: 6 },
        ]
      : [
          { label: 'Morning', start: 6, end: 12 },
          { label: 'Afternoon', start: 12, end: 18 },
          { label: 'Evening', start: 18, end: 22 },
        ];

  const periods: TouristPeriod[] = [];
  for (const band of bands) {
    const slice = hours.filter((h) => {
      const hr = hourIct(h.validTimeUtc);
      return hr >= band.start && hr < band.end;
    });
    if (!slice.length) continue;
    const p = mean(slice.map((h) => h.pop1h).filter(finite));
    const tt = slice.map((h) => h.tempC).filter(finite);
    const rate = maxNum(slice.map((h) => h.precipRate).filter(finite)) ?? 0;
    const thunder = maxNum(slice.map((h) => h.thunderPct).filter(finite));
    let text = 'Quiet on this issuance.';
    if (p != null && p >= 45) text = `Chance of rain around ${Math.round(p)}%. Stay near cover.`;
    else if (p != null && p >= 25) text = `Some rain possible (${Math.round(p)}% chance). Flexible is fine.`;
    else if (p != null) text = `Low chance of rain (${Math.round(p)}%).`;
    if (rate >= 1) text += ' Heavier bursts in the model.';
    if (thunder != null && thunder >= 20) text += ` Thunder risk about ${Math.round(thunder)}%.`;
    const tLo = minNum(tt);
    const tHi = maxNum(tt);
    periods.push({
      label: band.label,
      hourRange: `${String(band.start).padStart(2, '0')}:00–${String(band.end).padStart(2, '0')}:00`,
      text,
      rainChancePct: p == null ? null : Math.round(p),
      tempBandC:
        tLo != null && tHi != null ? `${Math.round(tLo)}–${Math.round(tHi)}°C` : '—',
    });
  }
  return { headline, periods };
}

type SnapshotRow = {
  issuance_time_utc: string;
  retrieved_at_utc: string | null;
  valid_time_utc: string;
  forecast_lead_hours: number | null;
  air_temperature_c: number | null;
  relative_humidity: number | null;
  wind_speed_ms: number | null;
  precipitation_rate: number | null;
  probability_of_precipitation_1hr: number | null;
  probability_of_precipitation_24hr: number | null;
  probability_of_thunderstorm: number | null;
  probability_of_fog: number | null;
  opf_overlay_applied: boolean | null;
  source_composition: unknown;
};

function toHour(row: SnapshotRow): OverviewHour {
  return {
    validTimeUtc: row.valid_time_utc,
    leadHours: finite(row.forecast_lead_hours) ? row.forecast_lead_hours : null,
    tempC: finite(row.air_temperature_c) ? row.air_temperature_c : null,
    humidityPct: finite(row.relative_humidity) ? row.relative_humidity : null,
    windMs: finite(row.wind_speed_ms) ? row.wind_speed_ms : null,
    precipRate: finite(row.precipitation_rate) ? row.precipitation_rate : null,
    pop1h: finite(row.probability_of_precipitation_1hr)
      ? row.probability_of_precipitation_1hr
      : null,
    pop24h: finite(row.probability_of_precipitation_24hr)
      ? row.probability_of_precipitation_24hr
      : null,
    thunderPct: finite(row.probability_of_thunderstorm)
      ? row.probability_of_thunderstorm
      : null,
    fogPct: finite(row.probability_of_fog) ? row.probability_of_fog : null,
    opfOverlayApplied: Boolean(row.opf_overlay_applied),
  };
}

function viewFromHours(
  date: string,
  slot: OverviewSlot,
  locationId: string,
  hours: OverviewHour[],
  meta: {
    locked: boolean;
    liveFallback: boolean;
    issuanceTimeUtc: string | null;
    retrievedAtUtc: string | null;
    sourceComposition: unknown;
  },
): OverviewSlotView {
  const start = slotStartUtc(date, slot);
  const temps = hours.map((h) => h.tempC).filter(finite);
  const pops = hours.map((h) => h.pop1h).filter(finite);
  const leads = hours.map((h) => h.leadHours).filter(finite);
  return {
    date,
    slot,
    label: SLOT_LABEL[slot],
    slotStartIct: start.toLocaleString('en-GB', {
      timeZone: ECOWITT_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      day: '2-digit',
      month: 'short',
    }),
    locked: meta.locked,
    liveFallback: meta.liveFallback,
    locationId,
    issuanceTimeUtc: meta.issuanceTimeUtc,
    retrievedAtUtc: meta.retrievedAtUtc,
    opfOverlayApplied: hours.some((h) => h.opfOverlayApplied),
    sourceComposition: meta.sourceComposition,
    leadHoursMin: minNum(leads),
    leadHoursMax: maxNum(leads),
    hourCount: hours.length,
    tempMinC: minNum(temps),
    tempMaxC: maxNum(temps),
    pop1hMeanPct: mean(pops),
    pop1hMaxPct: maxNum(pops),
    thunderMaxPct: maxNum(hours.map((h) => h.thunderPct).filter(finite)),
    fogMaxPct: maxNum(hours.map((h) => h.fogPct).filter(finite)),
    precipSumMm: (() => {
      const precip = hours.map((h) => h.precipRate).filter(finite);
      return precip.length ? round3(precip.reduce((s, v) => s + v, 0)) : null;
    })(),
    windMaxMs: maxNum(hours.map((h) => h.windMs).filter(finite)),
    tourist: touristSummary(hours, slot),
    hours,
    accuracy: null,
  };
}

const SNAP_SELECT =
  'issuance_time_utc,retrieved_at_utc,valid_time_utc,forecast_lead_hours,air_temperature_c,relative_humidity,wind_speed_ms,precipitation_rate,probability_of_precipitation_1hr,probability_of_precipitation_24hr,probability_of_thunderstorm,probability_of_fog,opf_overlay_applied,source_composition';

async function pickIssuance(
  locationId: string,
  slotAt: Date,
): Promise<string | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const from = new Date(slotAt.getTime() - ISSUANCE_BEFORE_MS).toISOString();
  const to = new Date(slotAt.getTime() + ISSUANCE_AFTER_MS).toISOString();
  const { data, error } = await sb
    .from('weather_forecast_snapshot')
    .select('issuance_time_utc,retrieved_at_utc')
    .eq('location_id', locationId)
    .gte('retrieved_at_utc', from)
    .lt('retrieved_at_utc', to)
    .limit(4000);
  const rows = (!error && data?.length
    ? data
    : (
        await sb
          .from('weather_forecast_snapshot')
          .select('issuance_time_utc,retrieved_at_utc')
          .eq('location_id', locationId)
          .gte('issuance_time_utc', from)
          .lt('issuance_time_utc', to)
          .limit(4000)
      ).data) as { issuance_time_utc: string; retrieved_at_utc: string | null }[] | null;
  if (!rows?.length) return null;
  const byIssuance = new Map<string, number>();
  for (const row of rows) {
    const stamp = Date.parse(row.retrieved_at_utc || row.issuance_time_utc);
    const prev = byIssuance.get(row.issuance_time_utc);
    if (prev == null || Math.abs(stamp - slotAt.getTime()) < Math.abs(prev - slotAt.getTime())) {
      byIssuance.set(row.issuance_time_utc, stamp);
    }
  }
  let best: string | null = null;
  let bestDist = Infinity;
  const target = slotAt.getTime();
  for (const [iso, stamp] of byIssuance) {
    const dist = Math.abs(stamp - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = iso;
    }
  }
  return best;
}

async function hoursForIssuance(
  locationId: string,
  issuance: string,
  start: Date,
  end: Date,
): Promise<SnapshotRow[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const { data, error } = await sb
    .from('weather_forecast_snapshot')
    .select(SNAP_SELECT)
    .eq('location_id', locationId)
    .eq('issuance_time_utc', issuance)
    .gte('valid_time_utc', start.toISOString())
    .lt('valid_time_utc', end.toISOString())
    .order('valid_time_utc', { ascending: true })
    .limit(48);
  if (error) return [];
  return (data || []) as SnapshotRow[];
}

async function hoursFromRolling(
  locationId: string,
  start: Date,
  end: Date,
): Promise<SnapshotRow[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const { data, error } = await sb
    .from('weather_forecast')
    .select(
      'issuance_time_utc,updated_at,valid_time_utc,air_temperature_c,relative_humidity,wind_speed_ms,precipitation_rate,probability_of_precipitation_1hr,probability_of_precipitation_24hr,probability_of_thunderstorm,probability_of_fog',
    )
    .eq('location_id', locationId)
    .gte('valid_time_utc', start.toISOString())
    .lt('valid_time_utc', end.toISOString())
    .order('valid_time_utc', { ascending: true })
    .limit(48);
  if (error || !data?.length) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    issuance_time_utc: String(r.issuance_time_utc || ''),
    retrieved_at_utc: r.updated_at ? String(r.updated_at) : null,
    valid_time_utc: String(r.valid_time_utc),
    forecast_lead_hours: null,
    air_temperature_c: finite(r.air_temperature_c) ? r.air_temperature_c : null,
    relative_humidity: finite(r.relative_humidity) ? r.relative_humidity : null,
    wind_speed_ms: finite(r.wind_speed_ms) ? r.wind_speed_ms : null,
    precipitation_rate: finite(r.precipitation_rate) ? r.precipitation_rate : null,
    probability_of_precipitation_1hr: finite(r.probability_of_precipitation_1hr)
      ? r.probability_of_precipitation_1hr
      : null,
    probability_of_precipitation_24hr: finite(r.probability_of_precipitation_24hr)
      ? r.probability_of_precipitation_24hr
      : null,
    probability_of_thunderstorm: finite(r.probability_of_thunderstorm)
      ? r.probability_of_thunderstorm
      : null,
    probability_of_fog: finite(r.probability_of_fog) ? r.probability_of_fog : null,
    opf_overlay_applied: true,
    source_composition: { live_rolling: true },
  }));
}

type LockRow = {
  issuance_time_utc: string;
  retrieved_at_utc: string | null;
  forecast_json: Record<string, unknown> | null;
  verification_json: SlotAccuracy | null;
};

function forecastBlob(view: OverviewSlotView): Record<string, unknown> {
  return {
    tourist: view.tourist,
    hours: view.hours,
    tempMinC: view.tempMinC,
    tempMaxC: view.tempMaxC,
    pop1hMeanPct: view.pop1hMeanPct,
    pop1hMaxPct: view.pop1hMaxPct,
    thunderMaxPct: view.thunderMaxPct,
    fogMaxPct: view.fogMaxPct,
    precipSumMm: view.precipSumMm,
    windMaxMs: view.windMaxMs,
    opfOverlayApplied: view.opfOverlayApplied,
    sourceComposition: view.sourceComposition,
    leadHoursMin: view.leadHoursMin,
    leadHoursMax: view.leadHoursMax,
    rainUncalibrated: true,
  };
}

async function readLock(
  locationId: string,
  date: string,
  slot: OverviewSlot,
): Promise<SlotLockRecord | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from(SLOT_LOCK_TABLE)
    .select('issuance_time_utc,retrieved_at_utc,forecast_json,verification_json')
    .eq('location_id', locationId)
    .eq('slot_date_ict', date)
    .eq('slot', slot)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as LockRow;
  return {
    locationId,
    date,
    slot,
    issuanceTimeUtc: row.issuance_time_utc,
    retrievedAtUtc: row.retrieved_at_utc,
    forecastJson: row.forecast_json || {},
    verificationJson: row.verification_json,
  };
}

async function writeLock(view: OverviewSlotView): Promise<boolean> {
  if (!view.issuanceTimeUtc) return false;
  const sb = getSupabaseAdmin();
  if (!sb) return false;
  const incoming: SlotLockRecord = {
    locationId: view.locationId,
    date: view.date,
    slot: view.slot,
    issuanceTimeUtc: view.issuanceTimeUtc,
    retrievedAtUtc: view.retrievedAtUtc,
    forecastJson: forecastBlob(view),
    verificationJson: view.accuracy,
  };
  const existing = await readLock(view.locationId, view.date, view.slot);
  const { record, duplicated } = applyLockOnce(existing, incoming);
  const payload = {
    location_id: record.locationId,
    slot_date_ict: record.date,
    slot: record.slot,
    issuance_time_utc: record.issuanceTimeUtc,
    retrieved_at_utc: record.retrievedAtUtc,
    opf_overlay_applied: view.opfOverlayApplied,
    source_composition: view.sourceComposition,
    lead_hours_min: view.leadHoursMin,
    lead_hours_max: view.leadHoursMax,
    hour_count: view.hourCount,
    forecast_json: record.forecastJson,
    verification_json: record.verificationJson,
    verified_at: record.verificationJson ? new Date().toISOString() : null,
    locked_at: duplicated && existing ? undefined : new Date().toISOString(),
  };
  const row = duplicated && existing
    ? {
        verification_json: record.verificationJson,
        verified_at: record.verificationJson ? new Date().toISOString() : null,
      }
    : payload;
  if (duplicated && existing) {
    const { error } = await sb
      .from(SLOT_LOCK_TABLE)
      .update(row)
      .eq('location_id', view.locationId)
      .eq('slot_date_ict', view.date)
      .eq('slot', view.slot);
    return !error;
  }
  const { error } = await sb.from(SLOT_LOCK_TABLE).insert(payload);
  return !error;
}

export async function loadSlotView(
  date: string,
  slot: OverviewSlot,
  locationId = SPIRE_LOCATION_ID,
  opts?: { persist?: boolean; allowLive?: boolean },
): Promise<OverviewSlotView> {
  const start = slotStartUtc(date, slot);
  const sliceEnd = new Date(start.getTime() + LOOKAHEAD_H * 3600 * 1000);
  const persist = opts?.persist !== false;
  const allowLive = opts?.allowLive !== false;

  const existing = await readLock(locationId, date, slot);
  let issuance = existing?.issuanceTimeUtc ?? null;
  let locked = Boolean(issuance);
  if (!issuance) issuance = await pickIssuance(locationId, start);

  const frozenHours = Array.isArray(existing?.forecastJson?.hours)
    ? (existing!.forecastJson.hours as OverviewHour[])
    : null;
  let rows: SnapshotRow[] = [];
  if (!frozenHours?.length && issuance) {
    rows = await hoursForIssuance(locationId, issuance, start, sliceEnd);
  }

  let liveFallback = false;
  if (!frozenHours?.length && !rows.length && allowLive) {
    rows = await hoursFromRolling(locationId, start, sliceEnd);
    liveFallback = rows.length > 0;
    locked = false;
  }

  const hours = frozenHours?.length ? frozenHours : rows.map(toHour);
  const view = viewFromHours(date, slot, locationId, hours, {
    locked: locked && !liveFallback,
    liveFallback,
    issuanceTimeUtc: issuance || rows[0]?.issuance_time_utc || null,
    retrievedAtUtc: rows[0]?.retrieved_at_utc || null,
    sourceComposition: rows[0]?.source_composition ?? null,
  });

  const slotPassed = Date.now() >= start.getTime();
  if (persist && slotPassed && view.issuanceTimeUtc && !liveFallback) {
    try {
      await writeLock(view);
      view.locked = true;
    } catch {
      /* table may not be migrated yet */
    }
  }
  return view;
}

export function scoreSlotWindow(
  station: EcowittDaySample[],
  hours: OverviewHour[],
  windowStart: Date,
  windowEnd: Date,
): SlotAccuracy {
  const temps = station.map((s) => s.temperature_c).filter(finite);
  const fcTemps = hours.map((h) => h.tempC).filter(finite);
  const stMean = mean(temps);
  const fcMean = mean(fcTemps);
  return {
    windowStartUtc: windowStart.toISOString(),
    windowEndUtc: windowEnd.toISOString(),
    stationSampleCount: station.length,
    stationTempMinC: minNum(temps),
    stationTempMaxC: maxNum(temps),
    stationTempMeanC: stMean,
    forecastTempMinC: minNum(fcTemps),
    forecastTempMaxC: maxNum(fcTemps),
    forecastTempMeanC: fcMean,
    tempMeanErrorC:
      stMean != null && fcMean != null ? round3(fcMean - stMean) : null,
    stationRainDeltaMm: rainCounterDelta(station),
    stationRainRateMaxMmh: maxNum(station.map((s) => s.rain_rate_mmh).filter(finite)),
    stationRainDayMmEnd: (() => {
      const last = [...station].reverse().find((s) => finite(s.rain_day_mm));
      return last?.rain_day_mm ?? null;
    })(),
    forecastPrecipSumMm: round3(
      hours.map((h) => h.precipRate).filter(finite).reduce((s, v) => s + v, 0) || null,
    ),
    forecastPop1hMeanPct: mean(hours.map((h) => h.pop1h).filter(finite)),
    forecastPop1hMaxPct: maxNum(hours.map((h) => h.pop1h).filter(finite)),
    forecastThunderMeanPct: mean(hours.map((h) => h.thunderPct).filter(finite)),
    thunderObservable: false,
    rainSkillNote: RAIN_SKILL_NOTE,
  };
}

export async function lockDueSlots(
  locationId = SPIRE_LOCATION_ID,
  at = new Date(),
): Promise<{ date: string; slot: OverviewSlot; locked: boolean }[]> {
  const current = currentOverviewSlot(at);
  const prev = previousOverviewSlot(current.date, current.slot);
  const out: { date: string; slot: OverviewSlot; locked: boolean }[] = [];
  for (const key of [prev, current]) {
    out.push(await lockSlot(key.date, key.slot, locationId));
  }
  return out;
}

export async function lockSlot(
  date: string,
  slot: OverviewSlot,
  locationId = SPIRE_LOCATION_ID,
): Promise<{ date: string; slot: OverviewSlot; locked: boolean }> {
  const view = await loadSlotView(date, slot, locationId, {
    persist: true,
    allowLive: false,
  });
  return { date, slot, locked: view.locked };
}

export async function buildForecastOverview(opts?: {
  date?: string;
  locationId?: string;
  persist?: boolean;
}): Promise<ForecastOverview> {
  const locationId = opts?.locationId || SPIRE_LOCATION_ID;
  const now = new Date();
  const current = currentOverviewSlot(now);
  const date = parseIctDateYmd(opts?.date) || current.date;
  const previous = previousOverviewSlot(
    date === current.date ? current.date : date,
    date === current.date ? current.slot : '1800',
  );

  const slots: OverviewSlotView[] = [];
  for (const slot of OVERVIEW_SLOTS) {
    const persist =
      opts?.persist !== false &&
      (date < current.date || (date === current.date && slot <= current.slot));
    slots.push(
      await loadSlotView(date, slot, locationId, {
        persist,
        allowLive: date === current.date && slot === current.slot,
      }),
    );
  }

  const prevView =
    date === current.date
      ? await loadSlotView(previous.date, previous.slot, locationId, {
          persist: true,
          allowLive: false,
        })
      : slots.find((s) => s.slot === previous.slot) || null;

  const dayRange = ictDayUtcRange(date);
  if (dayRange) {
    const ecoDay = await fetchEcowittRange(dayRange.startUtc, dayRange.endUtc, ECOWITT_LOCATION_ID);
    if (ecoDay.ok) {
      for (const slotView of slots) {
        const w0 = slotStartUtc(slotView.date, slotView.slot);
        const w1 = slotEndUtc(slotView.date, slotView.slot);
        if (w0.getTime() >= Date.now()) continue;
        const samples = ecoDay.samples.filter((s) => {
          const t = Date.parse(s.observed_at);
          return t >= w0.getTime() && t < w1.getTime();
        });
        const accHours = slotView.hours.filter((h) => {
          const t = Date.parse(h.validTimeUtc);
          return t >= w0.getTime() && t < w1.getTime();
        });
        slotView.accuracy = scoreSlotWindow(samples, accHours, w0, w1);
        if (slotView.locked && slotView.accuracy) {
          try {
            await writeLock(slotView);
          } catch {
            /* verification column optional until 023 is applied */
          }
        }
      }
    }
  }

  let previousAccuracy: SlotAccuracy | null = null;
  if (prevView) {
    previousAccuracy =
      slots.find((s) => s.date === prevView.date && s.slot === prevView.slot)?.accuracy ??
      prevView.accuracy;
    if (!previousAccuracy && prevView.date !== date) {
      const w0 = slotStartUtc(prevView.date, prevView.slot);
      const w1 = slotEndUtc(prevView.date, prevView.slot);
      const eco = await fetchEcowittRange(w0, w1, ECOWITT_LOCATION_ID);
      if (eco.ok) {
        previousAccuracy = scoreSlotWindow(eco.samples, prevView.hours, w0, w1);
      }
    }
  }

  const day = await fetchEcowittDaily(date, ECOWITT_LOCATION_ID);
  const today = ictYmd(now);
  const latest = await fetchLatestEcowittObservation(ECOWITT_LOCATION_ID);

  return {
    timezone: ECOWITT_TIME_ZONE,
    locationId,
    stationLocationId: ECOWITT_LOCATION_ID,
    generatedAt: now.toISOString(),
    current,
    previous,
    slots,
    previousAccuracy,
    rollingDay: {
      date,
      stationRainDayMm: day.ok ? day.summary.rainDayMm : null,
      stationTempMinC: day.ok ? day.summary.temperatureMinC : null,
      stationTempMaxC: day.ok ? day.summary.temperatureMaxC : null,
      stationSampleCount: day.ok ? day.summary.sampleCount : 0,
      complete: date < today,
    },
    now: latest.ok
      ? {
          tempC: latest.observation.temperatureC,
          rainRateMmh: latest.observation.rainRateMmh,
          rainDayMm: latest.observation.rainDayMm,
          observedAt: latest.observation.observedAt,
        }
      : null,
    rainSkillNote: RAIN_SKILL_NOTE,
  };
}
