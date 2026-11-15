import type { Metadata } from 'next';
import NowcastPanel from '@/components/nowcast/NowcastPanel';
import '@/components/nowcast/nowcast-panel.css';

/**
 * EXPERIMENTAL preview page for the Samui rain nowcast. Not linked from anywhere; noindex.
 * The root layout locks body scrolling (overflow-hidden), so this page scrolls inside its own container.
 */
export const metadata: Metadata = {
  title: 'Rain nowcast (experimental) — Samui Weather',
  robots: { index: false, follow: false },
};

export default function NowcastPreviewPage() {
  return (
    <main className="nowcast-page">
      <p className="nowcast-preview-banner">
        <strong>EXPERIMENTAL PREVIEW</strong> &mdash; this page is not part of samuiweather.com.
      </p>
      <NowcastPanel />
    </main>
  );
}
