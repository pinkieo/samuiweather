'use client';

/**
 * Presentational radar scope for the experimental nowcast panel.
 * Echoes are the cells already returned by /api/nowcast. The loop only
 * steps those cells along the speed and heading the payload already
 * reports — it does not detect, track, or extrapolate anything new.
 * The last frame is the newest scan, with no time offset.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import type { NowcastCell } from '@/lib/nowcast/service';

/** Minutes relative to the newest scan. The loop plays forward and lands on 0. */
const LEADS_MIN = [-50, -40, -30, -20, -10, 0] as const;
const NOW_INDEX = LEADS_MIN.length - 1;
const FRAME_MS = 900;

/** Scope geometry. 70 km ring matches the verdict's near radius, with room for labels. */
const VB = 400;
const CX = 200;
const CY = 200;
const RANGE_KM = 78;
const PX_PER_KM = 186 / RANGE_KM;
const RINGS = [10, 30, 50, 70] as const;

/**
 * Koh Samui shore, clockwise from the north tip. Denser than the guest
 * silhouette in lib/daily-board-map.ts so the Chaweng bay and the long
 * north coast still read at radar scale. [lat, lon].
 */
const SAMUI: ReadonlyArray<readonly [number, number]> = [
  [9.592, 100.008],
  [9.594, 100.028],
  [9.586, 100.048],
  [9.574, 100.064],
  [9.562, 100.078],
  [9.552, 100.092],
  [9.544, 100.098],
  [9.532, 100.084],
  [9.518, 100.074],
  [9.504, 100.07],
  [9.488, 100.066],
  [9.472, 100.06],
  [9.458, 100.05],
  [9.446, 100.034],
  [9.434, 100.016],
  [9.428, 99.998],
  [9.434, 99.978],
  [9.45, 99.958],
  [9.47, 99.944],
  [9.492, 99.936],
  [9.514, 99.934],
  [9.536, 99.946],
  [9.556, 99.964],
  [9.572, 99.984],
  [9.586, 99.998],
];

/** Koh Phangan, north of Samui, simplified. */
const PHANGAN: ReadonlyArray<readonly [number, number]> = [
  [9.786, 100.008],
  [9.78, 100.042],
  [9.764, 100.072],
  [9.742, 100.092],
  [9.718, 100.084],
  [9.698, 100.058],
  [9.69, 100.028],
  [9.694, 99.996],
  [9.71, 99.972],
  [9.736, 99.966],
  [9.762, 99.978],
  [9.78, 99.994],
];

const BOPHUT = { lat: 9.56, lon: 100.03 };
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32 * Math.cos((BOPHUT.lat * Math.PI) / 180);

const DBZ_STOPS = [
  { label: '20+', color: '#22d3ee' },
  { label: '35', color: '#facc15' },
  { label: '40', color: '#fb923c' },
  { label: '45', color: '#f43f5e' },
  { label: '50', color: '#e879f9' },
] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Pixel {
  east: number;
  north: number;
  dbz: number;
  step: number;
}

interface PlottedCell {
  tid: number;
  maxDbz: number;
  pixels: Pixel[];
  centroidKm: number;
  centroidBrg: number;
  speedKmh: number;
  heading: number | null;
}

function dbzColor(dbz: number): string {
  if (dbz >= 50) return DBZ_STOPS[4].color;
  if (dbz >= 45) return DBZ_STOPS[3].color;
  if (dbz >= 40) return DBZ_STOPS[2].color;
  if (dbz >= 35) return DBZ_STOPS[1].color;
  return DBZ_STOPS[0].color;
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Radar-pixel cluster. Radius comes from the cell area; colour steps down toward the fringe. */
function echoPixels(areaKm2: number, maxDbz: number, tid: number): Pixel[] {
  const radius = Math.max(2.5, Math.min(14, Math.sqrt(Math.max(areaKm2, 1) / Math.PI)));
  const step = Math.max(1.15, Math.sqrt((Math.PI * radius * radius) / 120));
  const pixels: Pixel[] = [];
  for (let north = -radius; north <= radius; north += step) {
    for (let east = -radius; east <= radius; east += step) {
      const ang = Math.atan2(east, north);
      const wobble = 0.9 + 0.12 * hash(tid * 19 + Math.round(ang * 4));
      const limit = radius * wobble;
      const dist = Math.hypot(east, north);
      if (dist > limit) continue;
      const t = limit === 0 ? 0 : dist / limit;
      pixels.push({
        east,
        north,
        dbz: Math.max(20, maxDbz - t * 18),
        step,
      });
    }
  }
  pixels.sort((a, b) => a.dbz - b.dbz);
  return pixels;
}

function toSvg(eastKm: number, northKm: number): [number, number] {
  return [CX + eastKm * PX_PER_KM, CY - northKm * PX_PER_KM];
}

function along(bearingDeg: number, km: number): [number, number] {
  const r = (bearingDeg * Math.PI) / 180;
  return [km * Math.sin(r), km * Math.cos(r)];
}

function cellEastNorth(cell: PlottedCell, leadMin: number): [number, number] {
  const [east, north] = along(cell.centroidBrg, cell.centroidKm);
  if (cell.heading === null || cell.speedKmh <= 0) return [east, north];
  const [de, dn] = along(cell.heading, cell.speedKmh * (leadMin / 60));
  return [east + de, north + dn];
}

function coastPath(points: ReadonlyArray<readonly [number, number]>): string {
  return (
    points
      .map(([lat, lon], index) => {
        const east = (lon - BOPHUT.lon) * KM_PER_DEG_LON;
        const north = (lat - BOPHUT.lat) * KM_PER_DEG_LAT;
        const [x, y] = toSvg(east, north);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ') + ' Z'
  );
}

/** Percent position inside the square scope, for HTML labels that stay one size. */
function tagStyle(eastKm: number, northKm: number): { left: string; top: string } {
  const left = 50 + (eastKm * PX_PER_KM / VB) * 100;
  const top = 50 - (northKm * PX_PER_KM / VB) * 100;
  return { left: `${left.toFixed(2)}%`, top: `${top.toFixed(2)}%` };
}

function ringTag(km: number, bearingDeg: number, padKm: number) {
  const radius = km + padKm;
  const rad = (bearingDeg * Math.PI) / 180;
  return tagStyle(radius * Math.sin(rad), radius * Math.cos(rad));
}

function ictParts(unixSec: number): { hm: string; dayMonth: string } {
  const shifted = new Date((unixSec + 7 * 3600) * 1000);
  const hm = `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
  return { hm, dayMonth: `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]}` };
}

function starPoints(outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    pts.push(`${(radius * Math.cos(rad)).toFixed(2)},${(radius * Math.sin(rad)).toFixed(2)}`);
  }
  return pts.join(' ');
}

const SAMUI_PATH = coastPath(SAMUI);
const PHANGAN_PATH = coastPath(PHANGAN);
const STAR = starPoints(6.5, 2.6);

export default function NowcastRadar({ cells, frameUnix }: { cells: NowcastCell[]; frameUnix: number }) {
  const rawId = useId().replace(/:/g, '');
  const seaId = `nowcast-sea-${rawId}`;
  const clipId = `nowcast-clip-${rawId}`;
  const [index, setIndex] = useState(NOW_INDEX);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    setIndex(NOW_INDEX);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) {
      setPlaying(false);
      return;
    }
    setPlaying(true);
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setIndex((i) => (i + 1) % LEADS_MIN.length);
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [frameUnix]);

  const plotted = useMemo<PlottedCell[]>(() => {
    return cells
      .filter((cell) => cell.centroidKm <= 100)
      .map((cell) => ({
        tid: cell.tid,
        maxDbz: cell.maxDbz,
        pixels: echoPixels(cell.areaKm2, cell.maxDbz, cell.tid),
        centroidKm: cell.centroidKm,
        centroidBrg: cell.centroidBrg,
        speedKmh: cell.speedKmh,
        heading: cell.heading,
      }))
      .sort((a, b) => a.maxDbz - b.maxDbz);
  }, [cells]);

  const lead = LEADS_MIN[index] ?? 0;
  const clock = ictParts(frameUnix + lead * 60);
  const frameLabel = playing ? `frame ${index + 1}/${LEADS_MIN.length}` : 'newest scan';

  return (
    <figure className="nowcast-radar">
      <div className="nowcast-radar-head">
        <div className="nowcast-radar-titles">
          <p className="nowcast-radar-kicker">Koh Samui rain cells</p>
          <p className="nowcast-radar-sub">
            {clock.dayMonth} · {frameLabel}
            {playing ? ' · played along reported motion' : ''}
          </p>
        </div>
        <p className="nowcast-radar-clock">
          {clock.hm}
          <span className="nowcast-radar-tz">Bangkok · UTC+7</span>
        </p>
      </div>
      <ul className="nowcast-legend">
        <li className="nowcast-legend-label">dBZ</li>
        {DBZ_STOPS.map((stop) => (
          <li key={stop.label}>
            <i style={{ background: stop.color }} aria-hidden="true" />
            {stop.label}
          </li>
        ))}
      </ul>
      <div className="nowcast-stage">
      <svg
        className="nowcast-scope"
        viewBox={`0 0 ${VB} ${VB}`}
        role="img"
        aria-label={`Radar scope centred on Bo Phut at ${clock.hm} Bangkok time. Rings at 10, 30, 50 and 70 kilometres.`}
      >
        <defs>
          <radialGradient id={seaId} cx="50%" cy="46%" r="62%">
            <stop offset="0%" stopColor="#123044" />
            <stop offset="68%" stopColor="#071422" />
            <stop offset="100%" stopColor="#040b14" />
          </radialGradient>
          <clipPath id={clipId}>
            <circle cx={CX} cy={CY} r={188} />
          </clipPath>
        </defs>
        <circle cx={CX} cy={CY} r={188} fill={`url(#${seaId})`} />
        <g clipPath={`url(#${clipId})`}>
          <path d={SAMUI_PATH} fill="#1c4f3d" />
          <path d={PHANGAN_PATH} fill="#1c4f3d" />
          <g className="nowcast-echoes" shapeRendering="crispEdges">
            {plotted.map((cell) => {
              const [east, north] = cellEastNorth(cell, lead);
              const [x, y] = toSvg(east, north);
              return (
                <g key={cell.tid} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
                  {cell.pixels.map((pixel, pixelIndex) => {
                    const size = pixel.step * PX_PER_KM;
                    return (
                      <rect
                        key={pixelIndex}
                        x={pixel.east * PX_PER_KM - size / 2}
                        y={-pixel.north * PX_PER_KM - size / 2}
                        width={size}
                        height={size}
                        fill={dbzColor(pixel.dbz)}
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
          <path d={SAMUI_PATH} fill="none" stroke="#5eead4" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          <path d={PHANGAN_PATH} fill="none" stroke="#5eead4" strokeWidth={1.35} vectorEffect="non-scaling-stroke" />
        </g>
        {RINGS.filter((km) => km !== 10).map((km) => (
          <circle
            key={km}
            cx={CX}
            cy={CY}
            r={km * PX_PER_KM}
            fill="none"
            stroke="rgba(226,232,240,0.42)"
            strokeWidth={1.15}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <circle
          cx={CX}
          cy={CY}
          r={10 * PX_PER_KM}
          fill="none"
          stroke="#fb7185"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={CX} cy={CY} r={188} fill="none" stroke="rgba(226,232,240,0.28)" strokeWidth={1.25} />
        <polygon points={STAR} fill="#f8fafc" stroke="#061018" strokeWidth={1.2} transform={`translate(${CX} ${CY})`} />
      </svg>
      {RINGS.map((km) => (
        <span
          key={km}
          className={km === 10 ? 'nowcast-tag nowcast-tag--near' : 'nowcast-tag'}
          style={km === 10 ? ringTag(10, 262, 8) : ringTag(km, 72, 3.6)}
        >
          {km} km
        </span>
      ))}
      <span className="nowcast-tag nowcast-tag--place" style={tagStyle(2.2, -3.1)}>
        Bo Phut
      </span>
      </div>
      <div className="nowcast-frames" aria-hidden="true">
        {LEADS_MIN.map((leadMin, frameIndex) => (
          <i key={leadMin} data-on={frameIndex === index ? 'true' : 'false'} />
        ))}
      </div>
    </figure>
  );
}
