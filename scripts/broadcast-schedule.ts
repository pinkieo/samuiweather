#!/usr/bin/env npx tsx
/**
 * LENOVOX13 hourly driver: pick 07/11/15/19 feature or hourly bumper, skip overnight.
 *
 *   npx tsx scripts/broadcast-schedule.ts
 *   npx tsx scripts/broadcast-schedule.ts --dry-run
 *   npx tsx scripts/broadcast-schedule.ts --force
 */

import { config } from 'dotenv';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });

import {
  decideScheduledRender,
  type BroadcastManifest,
} from '../lib/broadcast-catalog';
import { slotForSchedule, type BroadcastScript, type BroadcastSlot } from '../lib/broadcast-script';

const BASE = process.env.BROADCAST_BASE_URL ?? 'http://localhost:3000';
const ROOT = resolve(process.cwd());
const LOG = path.join(ROOT, 'broadcast-out', 'schedule.log');
const MANIFEST = path.join(ROOT, 'public', 'broadcast', 'latest', 'manifest.json');

function log(line: string) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const msg = `${new Date().toISOString()} ${line}`;
  fs.appendFileSync(LOG, `${msg}\n`);
  console.log(line);
}

function readManifest(): BroadcastManifest | null {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as BroadcastManifest;
  } catch {
    return null;
  }
}

async function serverUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/broadcast/latest`, { cache: 'no-store' });
    return r.ok || r.status === 404;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<void> {
  if (await serverUp()) {
    log(`next already up at ${BASE}`);
    return;
  }
  log(`starting next dev on ${BASE}`);
  const child = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    shell: true,
    windowsHide: true,
  });
  child.unref();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await serverUp()) {
      log('next is ready');
      return;
    }
  }
  throw new Error(`next did not become ready at ${BASE}`);
}

async function fetchScript(slot: BroadcastSlot): Promise<BroadcastScript> {
  const res = await fetch(`${BASE}/api/broadcast/script?slot=${slot}`);
  const json = (await res.json()) as BroadcastScript & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `script HTTP ${res.status}`);
  return json;
}

function runRender(slot: BroadcastSlot) {
  const args =
    slot === 'hourly'
      ? ['tsx', 'scripts/broadcast-render.ts', '--hourly']
      : [
          'tsx',
          'scripts/broadcast-render.ts',
          '--slot',
          slot === 'feature_0700'
            ? '7'
            : slot === 'feature_1100'
              ? '11'
              : slot === 'feature_1500'
                ? '15'
                : '19',
        ];
  const r = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit', shell: true, env: process.env });
  if (r.status !== 0) throw new Error(`broadcast-render exit ${r.status}`);
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const latest = readManifest();
  const now = Date.now();
  const clockSlot = slotForSchedule(now);

  let decision = decideScheduledRender({ now, force, latest, scriptDelayed: null });
  log(`clock=${clockSlot} decision=${decision.action} ${decision.reason} slot=${decision.slot}`);

  if (dry) {
    console.log(JSON.stringify({ clockSlot, decision, dry: true }, null, 2));
    return;
  }
  if (decision.action === 'skip') {
    process.exit(0);
  }

  const slot = decision.slot;
  if (slot === 'skip') process.exit(0);

  await ensureServer();
  const script = await fetchScript(slot);
  decision = decideScheduledRender({
    now,
    force,
    latest,
    scriptDelayed: script.delayed,
  });
  log(`after script delayed=${script.delayed} decision=${decision.action} ${decision.reason}`);
  if (decision.action === 'skip') process.exit(0);

  runRender(slot);
  log(`render finished ${slot}`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  log(`FAILED ${msg}`);
  process.exit(1);
});
