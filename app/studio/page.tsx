import type { Metadata } from 'next';
import { parseBroadcastSlot } from '@/lib/broadcast-script';
import BroadcastStudio from '@/components/BroadcastStudio';

export const metadata: Metadata = {
  title: 'Sammi Studio',
  robots: { index: false, follow: false },
};

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ slot?: string; autoplay?: string }>;
}) {
  const q = await searchParams;
  const slot = parseBroadcastSlot(q.slot) ?? 'feature_0700';
  const autoplay = q.autoplay === '1' || q.autoplay === 'true';
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#020617]">
      <BroadcastStudio slot={slot} autoplay={autoplay} />
    </main>
  );
}
