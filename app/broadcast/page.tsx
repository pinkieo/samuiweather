import type { Metadata } from 'next';
import BroadcastPlayer from '@/components/BroadcastPlayer';

export const metadata: Metadata = {
  title: 'Sammi on air · Samui Weather',
  description: 'Koh Samui tourist weather TV — Sammi presents the island forecast.',
};

export default function BroadcastPage() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#020617]">
      <BroadcastPlayer />
    </main>
  );
}
