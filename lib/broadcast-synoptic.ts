/**
 * Synoptic one-liner for Sammi TV. Vietnam / Gulf moisture only when
 * easterly flow plus a rain or thunder window. Never invent a low.
 */

export type SynopticStory = {
  easterly: boolean;
  mentionVietnamLow: boolean;
  line: string | null;
};

function circularMeanDeg(values: number[]): number | null {
  if (!values.length) return null;
  let x = 0;
  let y = 0;
  for (const d of values) {
    const r = (d * Math.PI) / 180;
    x += Math.cos(r);
    y += Math.sin(r);
  }
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function meanWindDirDeg(rows: Array<{ windDir?: number | null }>): number | null {
  const vals = rows
    .map((r) => r.windDir)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d));
  return circularMeanDeg(vals);
}

/** Easterly-to-SE onshore for the Gulf / Vietnam approach. */
export function isEasterlyFeed(dirDeg: number | null): boolean {
  if (dirDeg == null) return false;
  return dirDeg >= 45 && dirDeg <= 135;
}

export function inferSynopticStory(opts: {
  windDirDeg: number | null;
  hasRainOrThunder: boolean;
  delayed?: boolean;
}): SynopticStory {
  if (opts.delayed) {
    return { easterly: false, mentionVietnamLow: false, line: null };
  }
  const easterly = isEasterlyFeed(opts.windDirDeg);
  const mentionVietnamLow = easterly && opts.hasRainOrThunder;
  if (mentionVietnamLow) {
    return {
      easterly,
      mentionVietnamLow: true,
      line: 'A low off Vietnam is feeding moisture across the Gulf toward Samui.',
    };
  }
  if (easterly) {
    return {
      easterly: true,
      mentionVietnamLow: false,
      line: 'Flow is off the east — Gulf air, not a named low on this run.',
    };
  }
  return {
    easterly: false,
    mentionVietnamLow: false,
    line: 'No east-side low on this run — island-scale weather.',
  };
}
