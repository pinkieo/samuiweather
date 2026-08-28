import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';
/** Global so Mapbox’s runtime check sees styles before any dynamically loaded map chunk. */
import 'mapbox-gl/dist/mapbox-gl.css';

export const metadata: Metadata = {
  title: 'Samui Weather',
  description: 'Koh Samui vacation weather — daily brief, radar, and island forecast',
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#020617',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="nl" className="h-full bg-[#020617]">
      <body
        className="min-h-[100dvh] min-h-[100svh] min-h-[100vh] overflow-hidden bg-[#020617] antialiased"
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
