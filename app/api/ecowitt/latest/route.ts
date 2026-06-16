import { NextResponse } from 'next/server';
import { fetchLatestEcowittObservation } from '@/lib/ecowitt-data';
import type { EcowittObservation } from '@/types/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface EcowittLatestResponse {
  observation: EcowittObservation | null;
  fetchedAt: number;
  error?: string;
}

export async function GET() {
  const result = await fetchLatestEcowittObservation();
  const body: EcowittLatestResponse = {
    observation: result.ok ? result.observation : null,
    fetchedAt: Date.now(),
    error: result.ok ? undefined : result.error,
  };
  return NextResponse.json(body);
}
