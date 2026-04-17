import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /** Mapbox / MapLibre — ensure Next bundles ESM correctly for interactive maps */
  transpilePackages: ['mapbox-gl', 'maplibre-gl'],

  // Suppress the DevTools issues-badge (Next.js 15 internal SegmentViewNode bug)
  // The dev server and app remain fully functional.
  devIndicators: false,

  // Silence verbose server-side logging for known 3rd-party fetch failures
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
};

export default nextConfig;
