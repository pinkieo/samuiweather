import type { SamuiWeatherForecastRow } from './spire';

const TZ = 'Asia/Bangkok';

/** Match {@link THUNDER_CAPE_JKG} in `DailyForecast` — convective risk. */
const THUNDER_CAPE_MIN = 1000;
/** At least this POP (or rain hint) to show the “afternoon shower” line. */
const MIN_SHOWER_PCT = 15;
/** Bangkok local hours treated as “this afternoon” for the shower one-liner. */
const AFTERNOON_START = 12;
const AFTERNOON_END = 18;
/** “After 3 PM” for the thunder one-liner (Bangkok). */
const PM_THUNDER_START = 15;

function bangkokDateKeyFromIso(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function bangkokDateKeyNow(d: Date): string {
  return d.toLocaleDateString('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function hourBangkok(iso: string): number {
  return parseInt(
    new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', hour12: false, timeZone: TZ }),
    10,
  );
}

function effectivePopHint(row: SamuiWeatherForecastRow): number {
  let p = row.pop;
  if (!p && row.precipRate > 0) {
    p = Math.min(100, Math.round(row.precipRate * 20) + 20);
  }
  if (row.sammi?.kansRegenPctSammi != null) {
    const k = row.sammi.kansRegenPctSammi;
    if (Number.isFinite(k)) p = Math.max(p, k);
  }
  return p;
}

export type HolidayNowAmenityHints = {
  /** Max POP for today afternoon; `null` if below show threshold. */
  afternoonShowerPct: number | null;
  /** True if a slot after 3 PM local looks thundery. */
  thunderAfter3pm: boolean;
};

/**
 * Optional friendly lines for the “Now · this hour” card — derived from the displayed hours.
 */
export function getHolidayNowAmenityHints(
  rows: SamuiWeatherForecastRow[],
  now: Date = new Date(),
): HolidayNowAmenityHints {
  const todayKey = bangkokDateKeyNow(now);
  const afternoon: SamuiWeatherForecastRow[] = [];
  let thunderAfter3pm = false;

  for (const r of rows) {
    if (bangkokDateKeyFromIso(r.time) !== todayKey) continue;
    const h = hourBangkok(r.time);
    if (h >= AFTERNOON_START && h < AFTERNOON_END) {
      afternoon.push(r);
    }
    if (h >= PM_THUNDER_START) {
      const p = effectivePopHint(r);
      const cape = r.cape;
      if (
        cape != null &&
        Number.isFinite(cape) &&
        cape >= THUNDER_CAPE_MIN &&
        (p >= 20 || r.precipRate > 0.08)
      ) {
        thunderAfter3pm = true;
      }
    }
  }

  let afternoonShowerPct: number | null = null;
  if (afternoon.length > 0) {
    const m = Math.max(...afternoon.map((r) => effectivePopHint(r)));
    if (m >= MIN_SHOWER_PCT) {
      afternoonShowerPct = Math.min(100, Math.round(m));
    }
  }

  return { afternoonShowerPct, thunderAfter3pm };
}

/**
 * One line for the small map caption: rain on the map vs forecast in the time bar. Same for
 * all regions; wording is tourist-friendly.
 */
export const HOLIDAY_MAP_FOOTER_LINE =
  'The map shows real rain right now. The time bar below is the forecast.';
