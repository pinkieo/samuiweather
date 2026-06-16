/**
 * Create or verify the cron-job.org task that polls Ecowitt Cloud every minute.
 *
 * Prerequisites:
 * 1. Account at https://cron-job.org (free tier supports minutely jobs)
 * 2. API key: Console → Settings → API key
 * 3. .env.local: CRON_SECRET, CRONJOB_ORG_API_KEY
 *
 * Usage: npm run ecowitt:cronjob-setup
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

const API = 'https://api.cron-job.org';
const JOB_TITLE = 'Samui Ecowitt → Supabase';
const JOB_URL_MARKER = '/api/cron/ecowitt-sync';

type CronJob = {
  jobId: number;
  title?: string;
  url?: string;
  enabled?: boolean;
};

type ListJobsResponse = { jobs?: CronJob[] };

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

function syncUrl(): string {
  const secret = process.env.CRON_SECRET?.trim();
  const base = process.env.ECOWITT_SYNC_BASE_URL?.trim() ?? 'https://www.samuiweather.com';
  if (!secret) {
    console.error('CRON_SECRET missing in .env.local');
    process.exit(1);
  }
  return `${base.replace(/\/$/, '')}/api/cron/ecowitt-sync?secret=${encodeURIComponent(secret)}`;
}

async function main() {
  const url = syncUrl();
  const list = await api<ListJobsResponse>('/jobs');
  const existing = (list.jobs ?? []).find(
    (j) => j.url?.includes(JOB_URL_MARKER) || j.title === JOB_TITLE,
  );

  if (existing) {
    console.log(`Already exists: jobId=${existing.jobId} enabled=${existing.enabled}`);
    console.log(`URL: ${existing.url}`);
    if (!existing.enabled) {
      await api('/jobs/' + existing.jobId, {
        method: 'PATCH',
        body: JSON.stringify({ job: { enabled: true } }),
      });
      console.log('Re-enabled job.');
    }
    return;
  }

  const body = {
    job: {
      title: JOB_TITLE,
      url,
      enabled: true,
      saveResponses: true,
      requestTimeout: 30,
      schedule: {
        timezone: 'Asia/Bangkok',
        expiresAt: 0,
        minutes: [-1],
        hours: [-1],
        mdays: [-1],
        months: [-1],
        wdays: [-1],
      },
    },
  };

  const created = await api<{ jobId: number }>('/jobs', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  console.log('Created cron-job.org task:', created.jobId);
  console.log('URL:', url);
  console.log('Schedule: every minute (Asia/Bangkok)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
