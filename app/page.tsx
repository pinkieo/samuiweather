import MapViewerClient from '@/components/MapViewerClient';

export default function Home() {
  return (
    <main className="fixed inset-0 z-0 box-border min-h-[100dvh] min-h-[100svh] min-h-[100vh] w-full overflow-hidden bg-[#020617]">
      <MapViewerClient />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-6">
        <div className="flex justify-end">
          <div className="pointer-events-auto rounded-full border border-white/5 bg-slate-900/50 px-4 py-2 text-[10px] font-bold tracking-widest text-cyan-400 backdrop-blur-md">
            SPIRE OPTIMIZED: PENDING (EST. 3 WEEKS)
          </div>
        </div>
      </div>
    </main>
  );
}
