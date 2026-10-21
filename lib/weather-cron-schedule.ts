/**
 * The four ICT ingest slots. cron-job.org must be updated in place:
 * a job that already exists is left on its old hours unless the setup
 * script patches the schedule.
 */

export const WEATHER_INGEST_HOURS_ICT = [0, 6, 12, 18] as const;
export const WEATHER_INGEST_MINUTE_ICT = 5;
export const WEATHER_INGEST_TIMEZONE = 'Asia/Bangkok';

export type CronSchedule = {
  timezone?: string;
  hours?: number[];
  minutes?: number[];
};

function sameNumbers(actual: number[] | undefined, expected: readonly number[]): boolean {
  if (!actual || actual.length !== expected.length) return false;
  const sorted = [...actual].sort((a, b) => a - b);
  return expected.every((hour, index) => sorted[index] === hour);
}

/** True when the schedule is the four ICT hours at `minute` past, Asia/Bangkok. */
export function ingestScheduleMatches(
  schedule: CronSchedule | null | undefined,
  minute: number = WEATHER_INGEST_MINUTE_ICT,
): boolean {
  if (!schedule) return false;
  return (
    schedule.timezone === WEATHER_INGEST_TIMEZONE &&
    sameNumbers(schedule.hours, WEATHER_INGEST_HOURS_ICT) &&
    sameNumbers(schedule.minutes, [minute])
  );
}
