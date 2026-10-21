/**
 * Create or verify cron-job.org tasks for 4× daily Spire ingest + overview lock.
 *
 * Prerequisites: CRON_SECRET, CRONJOB_ORG_API_KEY in .env.local
 * Usage: npm run weather:cronjob-setup
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { ingestScheduleMatches } from '../lib/weather-cron-schedule';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

const API = 'https://api.cron-job.org';
const BASE = process.env.WEATHER_SYNC_BASE_URL?.trim() ?? 'https://www.samuiweather.com';

type CronSchedule = {
  timezone?: string;
  expiresAt?: number;
  hours?: number[];
  minutes?: number[];
  mdays?: number[];
  months?: number[];
  wdays?: number[];
};
type CronJob = {
  jobId: number;
  title?: string;
  url?: string;
  enabled?: boolean;
  schedule?: CronSchedule;
};
type ListJobsResponse = { jobs?: CronJob[] };
type JobResponse = { job?: CronJob };

const JOBS = [
  {
    title: 'Samui weather ingest',
    marker: '/api/cron/weather-ingest',
    path: '/api/cron/weather-ingest',
    hours: [0, 6, 12, 18],
    minutes: [5],
    timeout: 30,
  },
  {
    title: 'Samui overview lock',
    marker: '/api/cron/overview-lock',
    path: '/api/cron/overview-lock',
    hours: [0, 6, 12, 18],
    minutes: [10],
    timeout: 30,
  },
] as const;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env.CRONJOB_ORG_API_KEY?.trim();
  if (!apiKey) {
    console.error('CRONJOB_ORG_API_KEY missing in .env.local');
    console.error('Get one at https://console.cron-job.org → Settings → API key');
    process.exit(1);
  }
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    console.error(`cron-job.org ${init?.method ?? 'GET'} ${path} → ${res.status}`, json);
    process.exit(1);
  }
  return json as T;
}

function jobUrl(path: string): string {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error('CRON_SECRET missing in .env.local');
    process.exit(1);
  }
  return `${BASE.replace(/\/$/, '')}${path}?secret=${encodeURIComponent(secret)}`;
}

function canonicalSchedule(spec: (typeof JOBS)[number]): CronSchedule {
  return {
    timezone: 'Asia/Bangkok',
    expiresAt: 0,
    minutes: [...spec.minutes],
    hours: [...spec.hours],
    mdays: [-1],
    months: [-1],
    wdays: [-1],
  };
}

async function ensureJob(spec: (typeof JOBS)[number], existing: CronJob[]) {
  const url = jobUrl(spec.path);
  const found = existing.find((j) => j.url?.includes(spec.marker) || j.title === spec.title);
  const schedule = canonicalSchedule(spec);
  if (found) {
    const detail = await api<JobResponse>('/jobs/' + found.jobId);
    const job = detail.job ?? found;
    const matches = job.enabled !== false && ingestScheduleMatches(job.schedule, spec.minutes[0]);
    console.log(
      `Already exists: ${spec.title} jobId=${found.jobId} enabled=${job.enabled} schedule=${matches ? 'ok' : 'stale'}`,
    );
    if (!matches) {
      await api('/jobs/' + found.jobId, {
        method: 'PATCH',
        body: JSON.stringify({ job: { enabled: true, schedule } }),
      });
      const mm = String(spec.minutes[0]).padStart(2, '0');
      console.log(`Updated schedule to 00:${mm} / 06:${mm} / 12:${mm} / 18:${mm} ICT.`);
    }
    return;
  }
  const created = await api<{ jobId: number }>('/jobs', {
    method: 'PUT',
    body: JSON.stringify({
      job: {
        title: spec.title,
        url,
        enabled: true,
        saveResponses: true,
        requestTimeout: spec.timeout,
        schedule,
      },
    }),
  });
  console.log(`Created ${spec.title}:`, created.jobId);
  console.log('Path:', spec.path);
  const mm = String(spec.minutes[0]).padStart(2, '0');
  console.log(`Schedule: 00:${mm} / 06:${mm} / 12:${mm} / 18:${mm} ICT`);
}

async function main() {
  const list = await api<ListJobsResponse>('/jobs');
  const jobs = list.jobs ?? [];
  for (const spec of JOBS) {
    await ensureJob(spec, jobs);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
