import Link from 'next/link';
import ForecastOverview from '@/components/ForecastOverview';

export const dynamic = 'force-dynamic';

export default function OverviewPage() {
  return (
    <main className="h-[100dvh] overflow-y-auto bg-[#020617] px-4 py-6 text-white sm:px-8">
      <div className="mx-auto max-w-5xl pb-16">
        <p className="mb-6 text-[12px]">
          <Link href="/" className="text-cyan-300 hover:underline">
            ← Map
          </Link>
        </p>
        <ForecastOverview />
      </div>
    </main>
  );
}
