export type RadarFrameLike = { path: string; time: number };

/** `YYYY-MM-DDTHH` in Asia/Bangkok for grouping. */
export function hourBucketKeyBangkok(utcSec: number): string {
  const s = new Date(utcSec * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return s.slice(0, 13).replace(' ', 'T');
}

/** Start of current clock-hour in Bangkok, as UTC unix seconds. */
export function bangkokWindowHourStarts(utcNowSec: number, past: number, future: number): number[] {
  const d = new Date(utcNowSec * 1000);
  const p = new Intl.DateTimeFormat('en', {
    timeZone:    'Asia/Bangkok',
    year:        'numeric',
    month:       '2-digit',
    day:         '2-digit',
    hour:        '2-digit',
    hour12:      false,
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? '0';
  const pad = (n: string) => n.padStart(2, '0');
  const iso = `${get('year')}-${pad(get('month'))}-${pad(get('day'))}T${pad(get('hour'))}:00:00+07:00`;
  const anchorSec = Math.floor(new Date(iso).getTime() / 1000);
  const out: number[] = [];
  for (let i = -past; i <= future; i++) out.push(anchorSec + i * 3600);
  return out;
}

export function mergeRadarFrames(past: RadarFrameLike[], nowcast: RadarFrameLike[]): RadarFrameLike[] {
  const byTime = new Map<number, RadarFrameLike>();
  for (const f of past) {
    if (f?.path && Number.isFinite(f.time)) byTime.set(f.time, f);
  }
  for (const f of nowcast) {
    if (f?.path && Number.isFinite(f.time)) byTime.set(f.time, f);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export type HourBucketRadar = {
  hourStartUtc: number;
  key: string;
  /** 0 = dry / no echo, 1 = echo at pin+ring, null = no scan in this hour */
  level: 0 | 1 | null;
};

/** Latest RainViewer scan within [hourStartUtc, hourStartUtc+3600) — best for map scrub. */
export function pickLatestFrameInHour(
  frames: RadarFrameLike[],
  hourStartUtc: number,
): RadarFrameLike | null {
  const hourEnd = hourStartUtc + 3600;
  const inHour = frames.filter((f) => f.time >= hourStartUtc && f.time < hourEnd);
  if (inHour.length === 0) return null;
  let best = inHour[0]!;
  for (let i = 1; i < inHour.length; i++) {
    const f = inHour[i]!;
    if (f.time > best.time) best = f;
  }
  return best;
}

/**
 * Frame for map scrub: first real scan in the hour; for **future** ICT hours with no hit,
 * use the nowcast frame whose time is closest to the middle of that hour (RainViewer
 * sometimes clusters all `time` stamps in the current hour).
 */
export function pickScrubFrameForHour(
  merged: RadarFrameLike[],
  nowcastOnly: RadarFrameLike[],
  hourStartUtc: number,
  currentBangkokHourStartUtc: number,
): RadarFrameLike | null {
  const direct = pickLatestFrameInHour(merged, hourStartUtc);
  if (direct) return direct;
  if (hourStartUtc <= currentBangkokHourStartUtc || nowcastOnly.length === 0) return null;
  const target = hourStartUtc + 1800;
  let best: RadarFrameLike | null = null;
  let bestAbs = Infinity;
  for (const f of nowcastOnly) {
    const abs = Math.abs(f.time - target);
    if (abs < bestAbs) {
      bestAbs = abs;
      best = f;
    }
  }
  return best;
}

export function buildHourlyRadarBuckets(
  hourStarts: number[],
  frames: RadarFrameLike[],
  sampleByFrameTime: Map<number, 0 | 1>,
): HourBucketRadar[] {
  return hourStarts.map((hourStartUtc) => {
    const key = hourBucketKeyBangkok(hourStartUtc);
    const hourEnd = hourStartUtc + 3600;
    let level: 0 | 1 | null = null;
    for (const f of frames) {
      if (f.time >= hourStartUtc && f.time < hourEnd) {
        const s = sampleByFrameTime.get(f.time);
        if (s == null) continue;
        if (level === null) level = s;
        else level = Math.max(level, s) as 0 | 1;
      }
    }
    return { hourStartUtc, key, level };
  });
}
