/**
 * Labelled sample for layout checks and screenshots when Supabase is absent.
 * Numbers are illustrative. The page must say they are not a live forecast.
 */

import {
  type BoardHourInput,
  type DailyBoard,
  type TemperaturePair,
  BIAS_MIN_SAMPLES,
  buildDailyBoard,
  temperatureBiasByIctHour,
} from '@/lib/daily-board';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function at(dateYmd: string, hour: number, dayOffset = 0): string {
  const noon = Date.parse(`${dateYmd}T12:00:00+07:00`);
  const shifted = new Date(noon + dayOffset * 86_400_000);
  const key = shifted.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return new Date(`${key}T${pad(hour)}:00:00+07:00`).toISOString();
}

function sampleHour(dateYmd: string, hour: number): BoardHourInput {
  const timeUtc = at(dateYmd, hour);
  if (hour < 10) {
    return {
      timeUtc,
      tempC: 27,
      rainChancePct: 10,
      cloudCoverPct: 22,
      capeJkg: 220,
      windMs: 2.2,
      uvIndex: hour < 8 ? 2 : 4,
    };
  }
  if (hour < 14) {
    return {
      timeUtc,
      tempC: 30.4,
      rainChancePct: 22,
      cloudCoverPct: 48,
      capeJkg: 900,
      windMs: 3.4,
      uvIndex: hour === 12 ? 11 : 8,
    };
  }
  if (hour < 18) {
    return {
      timeUtc,
      tempC: 29,
      rainChancePct: 58,
      cloudCoverPct: 78,
      capeJkg: 420,
      windMs: 4.1,
      uvIndex: 5,
    };
  }
  return {
    timeUtc,
    tempC: 28,
    rainChancePct: hour >= 20 ? 18 : 28,
    cloudCoverPct: 55,
    capeJkg: 260,
    windMs: 2.8,
    uvIndex: hour >= 20 ? null : 1,
  };
}

/** Prior days: forecast too warm at 06–09, about 2.5°C cool at 14–17. */
export function sampleTemperaturePairs(dateYmd: string): TemperaturePair[] {
  const pairs: TemperaturePair[] = [];
  for (let day = 1; day <= BIAS_MIN_SAMPLES + 1; day++) {
    for (let hour = 6; hour < 18; hour++) {
      const validTimeUtc = at(dateYmd, hour, -day);
      if (hour < 10) {
        pairs.push({ validTimeUtc, forecastTempC: 28, stationTempC: 26.2 });
      } else if (hour >= 14) {
        pairs.push({ validTimeUtc, forecastTempC: 29, stationTempC: 31.5 });
      } else {
        pairs.push({ validTimeUtc, forecastTempC: 30, stationTempC: 30.2 });
      }
    }
  }
  return pairs;
}

export function sampleDailyBoard(dateYmd: string): DailyBoard {
  const hours = [];
  for (let hour = 6; hour < 22; hour++) hours.push(sampleHour(dateYmd, hour));
  const issuedAtUtc = new Date(`${dateYmd}T06:05:00+07:00`).toISOString();
  return buildDailyBoard({
    dateYmd,
    hours,
    bias: temperatureBiasByIctHour(sampleTemperaturePairs(dateYmd)),
    mode: 'sample',
    issuedAtUtc,
  });
}
