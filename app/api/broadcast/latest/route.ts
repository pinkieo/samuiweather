import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  evaluateBroadcastLatest,
  type BroadcastManifest,
} from '@/lib/broadcast-catalog';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MANIFEST = path.join(process.cwd(), 'public', 'broadcast', 'latest', 'manifest.json');

async function readManifest(): Promise<BroadcastManifest | null> {
  try {
    const raw = await fs.readFile(MANIFEST, 'utf8');
    const parsed = JSON.parse(raw) as BroadcastManifest;
    return parsed;
  } catch {
    return null;
  }
}

export async function GET() {
  const manifest = await readManifest();
  const latest = evaluateBroadcastLatest(manifest);
  return NextResponse.json(latest, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
