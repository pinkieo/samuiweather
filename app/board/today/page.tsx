import type { Metadata } from 'next';
import DailyForecastBoard from '@/components/DailyForecastBoard';
import { loadDailyBoard } from '@/lib/daily-board-load';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Today on Koh Samui · Samui Weather',
  description: 'Koh Samui daily forecast board — morning, midday, afternoon, and evening.',
};

export default async function DailyBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; sample?: string }>;
}) {
  const query = await searchParams;
  const board = await loadDailyBoard({
    dateYmd: query.date,
    sample: query.sample === '1',
  });
  return (
    <div className="bg-black">
      <DailyForecastBoard board={board} />
    </div>
  );
}
