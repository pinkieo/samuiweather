import type { Metadata } from 'next';
import BoardFullscreen from '@/components/BoardFullscreen';
import DailyForecastBoard from '@/components/DailyForecastBoard';
import { BOARD_LIVE_REFRESH_MS } from '@/lib/daily-board';
import { loadDailyBoard } from '@/lib/daily-board-load';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

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
      <BoardFullscreen refreshMs={board.mode === 'live' ? BOARD_LIVE_REFRESH_MS : 0}>
        <DailyForecastBoard board={board} />
      </BoardFullscreen>
    </div>
  );
}
