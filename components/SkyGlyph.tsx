'use client';

import {
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  Moon,
  Sun,
} from 'lucide-react';

export type SkyKind = 'sun' | 'moon' | 'partly' | 'cloud' | 'showers' | 'rain' | 'storm';

export function skyKindFromConditions(opts: {
  isDay: boolean;
  precipRate: number;
  cloudCover: number;
  thunder?: boolean;
}): SkyKind {
  if (opts.thunder) return 'storm';
  if (opts.precipRate > 0.5) return 'rain';
  if (opts.precipRate > 0.1) return 'showers';
  if (opts.cloudCover > 60) return 'cloud';
  if (opts.cloudCover > 20) return opts.isDay ? 'partly' : 'cloud';
  return opts.isDay ? 'sun' : 'moon';
}

const LABEL: Record<SkyKind, string> = {
  sun: 'Sun',
  moon: 'Clear night',
  partly: 'Partly cloudy',
  cloud: 'Cloudy',
  showers: 'Showers',
  rain: 'Rain',
  storm: 'Thunderstorm',
};

export default function SkyGlyph({
  kind,
  size = 22,
  className = '',
}: {
  kind: SkyKind;
  size?: number;
  className?: string;
}) {
  const cls = ['shrink-0', className].filter(Boolean).join(' ');
  const props = { className: cls, size, strokeWidth: 1.75, 'aria-hidden': true as const };
  switch (kind) {
    case 'moon':
      return <Moon {...props} className={`${cls} text-slate-200`} />;
    case 'partly':
      return <CloudSun {...props} className={`${cls} text-amber-200`} />;
    case 'cloud':
      return <Cloud {...props} className={`${cls} text-slate-300`} />;
    case 'showers':
      return <CloudRain {...props} className={`${cls} text-cyan-300`} />;
    case 'rain':
      return <CloudRain {...props} className={`${cls} text-sky-300`} />;
    case 'storm':
      return <CloudLightning {...props} className={`${cls} text-violet-300`} />;
    default:
      return <Sun {...props} className={`${cls} text-amber-300`} />;
  }
}

export function skyLabel(kind: SkyKind): string {
  return LABEL[kind];
}
