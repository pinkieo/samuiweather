import MapViewer from '@/components/MapViewer';

export default function Home() {
  return (
    <main className="relative h-screen w-full overflow-hidden bg-slate-950">
      <MapViewer />

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
