'use client';

import type { ReactNode } from 'react';
import { RadarFramesProvider } from '@/components/RadarFramesProvider';

export function Providers({ children }: { children: ReactNode }) {
  return <RadarFramesProvider>{children}</RadarFramesProvider>;
}
