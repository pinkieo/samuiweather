import MapViewerClient from '@/components/MapViewerClient';

export default function Home() {
  return (
    <main className="fixed inset-0 z-0 box-border min-h-[100dvh] min-h-[100svh] min-h-[100vh] w-full overflow-hidden bg-[#020617]">
      <MapViewerClient />
    </main>
  );
}
