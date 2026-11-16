/**
 * Koh Samui radar nowcast for the 4× daily forecast ingest.
 *
 * Published hourly rain chance stays the Spire value unless
 * NOWCAST_PUBLISH_CALIBRATED_LOWERING=1 and the Brier gate passes.
 * That flag ships off. Ecowitt wind is never a steering vector.
 */

export const SAMUI_NOWCAST_PIN = { lat: 9.5127, lon: 100.0137 } as const;

/** Fresh radar only. Older than this, the model hour is left alone. */
export const SAMUI_NOWCAST_STALE_SEC = 20 * 60;

export const SAMUI_NOWCAST_ECHO_DBZ = 20;
export const SAMUI_NOWCAST_RING_KM = 30;
export const SAMUI_NOWCAST_NEW_CELL_KM = 50;
export const SAMUI_NOWCAST_UPSTREAM_HOURS = 2;
export const SAMUI_NOWCAST_UPSTREAM_BUFFER_KM = 20;
/** Upwind semicircle: bearing from the island within this of the 700 hPa from-direction. */
export const SAMUI_NOWCAST_UPSTREAM_HALF_ANGLE_DEG = 90;

export const SAMUI_NOWCAST_MIN_TRACK_FRAMES = 3;
export const SAMUI_NOWCAST_MIN_TRACK_SPAN_SEC = 30 * 60;
export const SAMUI_NOWCAST_MIN_SPEED_KMH = 5;
export const SAMUI_NOWCAST_LINK_GATE_KM = 40;
export const SAMUI_NOWCAST_TRACK_BEARING_JITTER_DEG = 35;

export const SAMUI_NOWCAST_ENSEMBLE_MEMBERS = 9;
export const SAMUI_NOWCAST_NARROW_DIR_DEG = 10;
export const SAMUI_NOWCAST_NARROW_SPEED_FACTORS = [0.85, 1, 1.15] as const;
export const SAMUI_NOWCAST_WIDE_DIR_DEG = 30;
export const SAMUI_NOWCAST_WIDE_SPEED_FACTORS = [0.5, 1, 1.5] as const;
export const SAMUI_NOWCAST_DISAGREE_DEG = 45;
export const SAMUI_NOWCAST_DISAGREE_SPEED_FRAC = 0.5;
export const SAMUI_NOWCAST_MIN_WINDOW_MIN = 10;

export const SAMUI_NOWCAST_ISOLATED_HORIZON_MIN = 60;
export const SAMUI_NOWCAST_LINE_HORIZON_MIN = 120;
export const SAMUI_NOWCAST_LINE_MIN_FRAMES = 4;
export const SAMUI_NOWCAST_LINE_AREA_KM2 = 400;

export const SAMUI_NOWCAST_DRY_LEAD_HOURS = 2;
export const SAMUI_NOWCAST_SHOWER_FLAG_LEAD_HOURS = 6;

export const SAMUI_NOWCAST_GROWTH_DBZ = 5;
export const SAMUI_NOWCAST_GROWTH_AREA_FRAC = 0.25;

/** From-direction sector for a northeast monsoon surge (not the surface wind). */
export const SAMUI_NOWCAST_NE_FROM_MIN_DEG = 22.5;
export const SAMUI_NOWCAST_NE_FROM_MAX_DEG = 67.5;
export const SAMUI_NOWCAST_NE_SURGE_MIN_MS = 12;

export const SAMUI_NOWCAST_TEMP_DROP_C = 2;
export const SAMUI_NOWCAST_GUST_EXCESS_MS = 5;
export const SAMUI_NOWCAST_STATION_WINDOW_SEC = 30 * 60;

export const SAMUI_NOWCAST_MIN_ISSUANCES = 30;
export const SAMUI_NOWCAST_MIN_RAIN_EVENTS = 5;

/**
 * Calibrated lowering is withheld until replay beats the raw model.
 * Set the env var to `1` only after that gate is met. Default off.
 */
export const NOWCAST_PUBLISH_CALIBRATED_LOWERING = false;

/** One Northeast-monsoon season (about October–February) plus margin. Not 30 days. */
export const SAMUI_RADAR_ARCHIVE_RETENTION_DAYS = 180;

export type RadarCell = {
  lat: number;
  lon: number;
  dbz: number;
  areaKm2: number;
};

export type RadarScan = {
  timeUnix: number;
  /** RainViewer `radar.nowcast` frames are extrapolations, not genuine scans. */
  kind: 'past' | 'nowcast';
  cells: RadarCell[];
};

export type WindVector = { speedMps: number; fromDeg: number };

export type StationSample = {
  timeUnix: number;
  tempC: number | null;
  windSpeedMs: number | null;
  windGustMs: number | null;
  /** Present so callers can see it was supplied. Never used to steer a cell. */
  windFromDeg: number | null;
};

export type WindBin = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'unknown';

export type CalibrationSample = {
  month: string;
  windBin: WindBin;
  modelPopPct: number;
  candidatePopPct: number;
  observedRain: boolean;
};

export type NowcastHourInput = { validTimeUnix: number; popPct: number | null };

export type NowcastHour = {
  validTimeUnix: number;
  leadHours: number;
  originalPopPct: number | null;
  publishedPopPct: number | null;
  candidatePopPct: number | null;
  calledDry: boolean;
  showerCanStillForm: boolean;
  rainInEtaWindow: boolean;
  touched: boolean;
};

export type EtaMember = {
  directionToDeg: number;
  speedKmh: number;
  etaMin: number | null;
};

export type NowcastEta = {
  earliestUnix: number;
  latestUnix: number;
  earliestMin: number;
  latestMin: number;
  source: 'tracked' | '700hPa' | '850-500hPa-mean';
  horizonMin: number;
  spreadWidened: boolean;
  members: EtaMember[];
};

export type NowcastCellView = RadarCell & {
  nObs: number;
  distanceKm: number;
  growing: boolean;
};

export type NowcastState = 'unavailable' | 'stale' | 'clear' | 'developing' | 'approaching' | 'no_eta';

export type CalibrationGate = {
  allow: boolean;
  reason: string;
  issuances: number;
  rainEvents: number;
  brierModel: number | null;
  brierCandidate: number | null;
  month: string;
  windBin: WindBin;
};

export type NowcastDecision = {
  state: NowcastState;
  reason: string;
  radarTimeUnix: number | null;
  radarAgeSec: number | null;
  eta: NowcastEta | null;
  hours: NowcastHour[];
  publishLowering: boolean;
  calibration: CalibrationGate;
  cells: NowcastCellView[];
  stationWindUsedForSteering: false;
};

export type EvaluateNowcastInput = {
  nowUnix: number;
  pin?: { lat: number; lon: number };
  scans: RadarScan[] | null;
  reflectivityKnown: boolean;
  coverageRadiusKm?: number | null;
  wind700?: WindVector | null;
  wind850?: WindVector | null;
  wind500?: WindVector | null;
  station?: StationSample[] | null;
  hours?: NowcastHourInput[];
  publishCalibratedLowering?: boolean;
  calibrationSamples?: CalibrationSample[];
};

const EARTH_KM = 6371;

export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dφ = ((lat2 - lat1) * Math.PI) / 180;
  const dλ = ((lon2 - lon1) * Math.PI) / 180;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function destinationKm(
  lat: number,
  lon: number,
  bearing: number,
  distanceKm: number,
): { lat: number; lon: number } {
  const δ = distanceKm / EARTH_KM;
  const θ = (bearing * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return {
    lat: (φ2 * 180) / Math.PI,
    lon: ((((λ2 * 180) / Math.PI + 540) % 360) - 180),
  };
}

export function windBinFromDeg(fromDeg: number): WindBin {
  const bins: WindBin[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const d = ((fromDeg % 360) + 360) % 360;
  return bins[Math.round(d / 45) % 8]!;
}

export function utcMonth(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}`;
}

export function upstreamRadiusKm(speedMps: number): number {
  return speedMps * 3.6 * SAMUI_NOWCAST_UPSTREAM_HOURS + SAMUI_NOWCAST_UPSTREAM_BUFFER_KM;
}

function cleanWind(w: WindVector | null | undefined): WindVector | null {
  if (!w || !Number.isFinite(w.speedMps) || w.speedMps < 0 || !Number.isFinite(w.fromDeg)) return null;
  return { speedMps: w.speedMps, fromDeg: ((w.fromDeg % 360) + 360) % 360 };
}

function windToUv(speedMps: number, fromDeg: number): { u: number; v: number } {
  const r = (fromDeg * Math.PI) / 180;
  return { u: -speedMps * Math.sin(r), v: -speedMps * Math.cos(r) };
}

export function meanWind(a: WindVector, b: WindVector): WindVector {
  const ua = windToUv(a.speedMps, a.fromDeg);
  const ub = windToUv(b.speedMps, b.fromDeg);
  const u = (ua.u + ub.u) / 2;
  const v = (ua.v + ub.v) / 2;
  const speedMps = Math.hypot(u, v);
  const fromDeg = (Math.atan2(-u, -v) * 180) / Math.PI;
  return { speedMps, fromDeg: (fromDeg + 360) % 360 };
}

export type SteeringWind = WindVector & { source: '700hPa' | '850-500hPa-mean' };

/** 700 hPa first. Otherwise the vector mean of 850 and 500. Never the surface wind. */
export function selectSteeringWind(
  wind700: WindVector | null,
  wind850: WindVector | null,
  wind500: WindVector | null,
): SteeringWind | null {
  if (wind700) return { ...wind700, source: '700hPa' };
  if (wind850 && wind500) return { ...meanWind(wind850, wind500), source: '850-500hPa-mean' };
  return null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const LEVEL_PAIRS: Record<'700' | '850' | '500', [string, string][]> = {
  '700': [
    ['wind_speed_700hpa', 'wind_direction_700hpa'],
    ['wind_speed_700', 'wind_direction_700'],
    ['u_wind_700hpa', 'v_wind_700hpa'],
  ],
  '850': [
    ['wind_speed_850hpa', 'wind_direction_850hpa'],
    ['wind_speed_850', 'wind_direction_850'],
    ['u_wind_850hpa', 'v_wind_850hpa'],
  ],
  '500': [
    ['wind_speed_500hpa', 'wind_direction_500hpa'],
    ['wind_speed_500', 'wind_direction_500'],
    ['u_wind_500hpa', 'v_wind_500hpa'],
  ],
};

/** Read one pressure-level wind from a Spire `values` object. Missing keys stay null. */
export function readSpireLevelWind(
  values: Record<string, unknown> | null | undefined,
  level: '700' | '850' | '500',
): WindVector | null {
  if (!values) return null;
  for (const [speedKey, dirKey] of LEVEL_PAIRS[level]) {
    const speed = num(values[speedKey]);
    const dir = num(values[dirKey]);
    if (speed == null || dir == null) continue;
    if (speedKey.startsWith('u_')) {
      const speedMps = Math.hypot(speed, dir);
      const fromDeg = (Math.atan2(-speed, -dir) * 180) / Math.PI;
      return cleanWind({ speedMps, fromDeg });
    }
    return cleanWind({ speedMps: speed, fromDeg: dir });
  }
  return null;
}

export function isNeMonsoonSurge(wind: WindVector | null): boolean {
  if (!wind) return false;
  const from = ((wind.fromDeg % 360) + 360) % 360;
  return (
    from >= SAMUI_NOWCAST_NE_FROM_MIN_DEG &&
    from <= SAMUI_NOWCAST_NE_FROM_MAX_DEG &&
    wind.speedMps >= SAMUI_NOWCAST_NE_SURGE_MIN_MS
  );
}

export function stationSignals(
  samples: StationSample[] | null | undefined,
  nowUnix: number,
): { tempDrop: boolean; gustFront: boolean } {
  if (!samples?.length) return { tempDrop: false, gustFront: false };
  const window = samples
    .filter((s) => {
      const age = nowUnix - s.timeUnix;
      return age >= 0 && age <= SAMUI_NOWCAST_STATION_WINDOW_SEC;
    })
    .sort((a, b) => a.timeUnix - b.timeUnix);
  const temps = window.filter((s) => s.tempC != null && Number.isFinite(s.tempC));
  const tempDrop =
    temps.length >= 2 &&
    temps[0]!.tempC! - temps[temps.length - 1]!.tempC! >= SAMUI_NOWCAST_TEMP_DROP_C;
  const gustFront = window.some(
    (s) =>
      s.windGustMs != null &&
      s.windSpeedMs != null &&
      Number.isFinite(s.windGustMs) &&
      Number.isFinite(s.windSpeedMs) &&
      s.windGustMs - s.windSpeedMs >= SAMUI_NOWCAST_GUST_EXCESS_MS,
  );
  return { tempDrop, gustFront };
}

type Obs = RadarCell & { timeUnix: number };
type Track = { obs: Obs[] };

function genuinePast(scans: RadarScan[]): RadarScan[] {
  const past = scans
    .filter((s) => s.kind === 'past' && Number.isFinite(s.timeUnix))
    .sort((a, b) => a.timeUnix - b.timeUnix);
  const out: RadarScan[] = [];
  for (const scan of past) {
    const prev = out[out.length - 1];
    if (prev && prev.timeUnix === scan.timeUnix) continue;
    out.push(scan);
  }
  return out;
}

export function linkCellTracks(scans: RadarScan[]): Track[] {
  const frames = genuinePast(scans);
  if (!frames.length) return [];
  let tracks: Track[] = frames[0]!.cells.map((cell) => ({
    obs: [{ ...cell, timeUnix: frames[0]!.timeUnix }],
  }));
  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i]!;
    const prevTime = frames[i - 1]!.timeUnix;
    const used = new Set<number>();
    const next: Track[] = [];
    for (const track of tracks) {
      const last = track.obs[track.obs.length - 1]!;
      if (last.timeUnix !== prevTime) {
        next.push(track);
        continue;
      }
      let best = -1;
      let bestD = SAMUI_NOWCAST_LINK_GATE_KM;
      frame.cells.forEach((cell, idx) => {
        if (used.has(idx)) return;
        const d = haversineKm(last.lat, last.lon, cell.lat, cell.lon);
        if (d <= bestD) {
          bestD = d;
          best = idx;
        }
      });
      if (best >= 0) {
        used.add(best);
        const cell = frame.cells[best]!;
        track.obs.push({ ...cell, timeUnix: frame.timeUnix });
      }
      next.push(track);
    }
    frame.cells.forEach((cell, idx) => {
      if (used.has(idx)) return;
      next.push({ obs: [{ ...cell, timeUnix: frame.timeUnix }] });
    });
    tracks = next;
  }
  return tracks;
}

type MotionQuality = 'ok' | 'poor' | 'slow' | 'short';

type TrackMotion = {
  latest: Obs;
  nObs: number;
  spanSec: number;
  speedKmh: number;
  directionToDeg: number;
  growing: boolean;
  quality: MotionQuality;
  distanceKm: number;
};

function analyzeTrack(track: Track, pin: { lat: number; lon: number }): TrackMotion {
  const obs = track.obs;
  const latest = obs[obs.length - 1]!;
  const first = obs[0]!;
  const nObs = obs.length;
  const spanSec = latest.timeUnix - first.timeUnix;
  const dist = haversineKm(first.lat, first.lon, latest.lat, latest.lon);
  const speedKmh = spanSec > 0 ? dist / (spanSec / 3600) : 0;
  const directionToDeg = bearingDeg(first.lat, first.lon, latest.lat, latest.lon);
  let growing = false;
  if (nObs >= 2) {
    if (latest.dbz - first.dbz >= SAMUI_NOWCAST_GROWTH_DBZ) growing = true;
    if (
      first.areaKm2 > 0 &&
      (latest.areaKm2 - first.areaKm2) / first.areaKm2 >= SAMUI_NOWCAST_GROWTH_AREA_FRAC
    ) {
      growing = true;
    }
  }
  let quality: MotionQuality = 'ok';
  if (nObs < SAMUI_NOWCAST_MIN_TRACK_FRAMES || spanSec < SAMUI_NOWCAST_MIN_TRACK_SPAN_SEC) {
    quality = 'short';
  } else if (speedKmh < SAMUI_NOWCAST_MIN_SPEED_KMH) {
    quality = 'slow';
  } else {
    for (let i = 1; i < obs.length; i++) {
      const stepKm = haversineKm(obs[i - 1]!.lat, obs[i - 1]!.lon, obs[i]!.lat, obs[i]!.lon);
      if (stepKm < 1) continue;
      const stepBearing = bearingDeg(obs[i - 1]!.lat, obs[i - 1]!.lon, obs[i]!.lat, obs[i]!.lon);
      if (angleDiffDeg(stepBearing, directionToDeg) > SAMUI_NOWCAST_TRACK_BEARING_JITTER_DEG) {
        quality = 'poor';
        break;
      }
    }
  }
  return {
    latest,
    nObs,
    spanSec,
    speedKmh,
    directionToDeg,
    growing,
    quality,
    distanceKm: haversineKm(pin.lat, pin.lon, latest.lat, latest.lon),
  };
}

function inUpstream(
  pin: { lat: number; lon: number },
  cell: { lat: number; lon: number },
  fromDeg: number,
  radiusKm: number,
): boolean {
  const d = haversineKm(pin.lat, pin.lon, cell.lat, cell.lon);
  if (d > radiusKm) return false;
  const toCell = bearingDeg(pin.lat, pin.lon, cell.lat, cell.lon);
  return angleDiffDeg(toCell, fromDeg) <= SAMUI_NOWCAST_UPSTREAM_HALF_ANGLE_DEG;
}

function inWatch(
  pin: { lat: number; lon: number },
  cell: { lat: number; lon: number },
  wind700: WindVector | null,
): boolean {
  const d = haversineKm(pin.lat, pin.lon, cell.lat, cell.lon);
  if (d <= SAMUI_NOWCAST_RING_KM) return true;
  if (!wind700) return false;
  return inUpstream(pin, cell, wind700.fromDeg, upstreamRadiusKm(wind700.speedMps));
}

function horizonMin(motion: TrackMotion): number {
  if (motion.nObs >= SAMUI_NOWCAST_LINE_MIN_FRAMES && motion.latest.areaKm2 >= SAMUI_NOWCAST_LINE_AREA_KM2) {
    return SAMUI_NOWCAST_LINE_HORIZON_MIN;
  }
  return SAMUI_NOWCAST_ISOLATED_HORIZON_MIN;
}

function etaMinutes(
  cell: { lat: number; lon: number; areaKm2: number },
  pin: { lat: number; lon: number },
  directionToDeg: number,
  speedKmh: number,
  horizon: number,
): number | null {
  if (speedKmh <= 0) return null;
  const toPin = bearingDeg(cell.lat, cell.lon, pin.lat, pin.lon);
  const diff = angleDiffDeg(directionToDeg, toPin);
  if (diff >= 90) return null;
  const closing = speedKmh * Math.cos((diff * Math.PI) / 180);
  if (closing < 1) return null;
  const radius = Math.sqrt(Math.max(cell.areaKm2, 0) / Math.PI);
  const dist = Math.max(0, haversineKm(cell.lat, cell.lon, pin.lat, pin.lon) - radius);
  const minutes = (dist / closing) * 60;
  if (minutes > horizon) return null;
  return minutes;
}

function buildEta(
  motion: TrackMotion,
  pin: { lat: number; lon: number },
  steering: SteeringWind | null,
  nowUnix: number,
): NowcastEta | null {
  const trackedOk = motion.quality === 'ok';
  const windToward = steering ? (steering.fromDeg + 180) % 360 : null;
  const windKmh = steering ? steering.speedMps * 3.6 : null;
  let centerDir = motion.directionToDeg;
  let centerSpeed = motion.speedKmh;
  let source: NowcastEta['source'] = 'tracked';
  if (!trackedOk) {
    if (!steering || windToward == null || windKmh == null) return null;
    centerDir = windToward;
    centerSpeed = windKmh;
    source = steering.source;
  }
  const canCompare = steering != null && windToward != null && windKmh != null && motion.nObs >= 2 && motion.spanSec > 0;
  const spreadWidened =
    canCompare &&
    (angleDiffDeg(motion.directionToDeg, windToward!) > SAMUI_NOWCAST_DISAGREE_DEG ||
      Math.abs(motion.speedKmh - windKmh!) / Math.max(motion.speedKmh, windKmh!, 0.1) >
        SAMUI_NOWCAST_DISAGREE_SPEED_FRAC);
  const dirStep = spreadWidened ? SAMUI_NOWCAST_WIDE_DIR_DEG : SAMUI_NOWCAST_NARROW_DIR_DEG;
  const speedFactors = spreadWidened
    ? SAMUI_NOWCAST_WIDE_SPEED_FACTORS
    : SAMUI_NOWCAST_NARROW_SPEED_FACTORS;
  const horizon = horizonMin(motion);
  const members: EtaMember[] = [];
  for (const dirSign of [-1, 0, 1]) {
    for (const factor of speedFactors) {
      const directionToDeg = (centerDir + dirSign * dirStep + 360) % 360;
      const speedKmh = centerSpeed * factor;
      members.push({
        directionToDeg,
        speedKmh,
        etaMin: etaMinutes(motion.latest, pin, directionToDeg, speedKmh, horizon),
      });
    }
  }
  const hits = members.map((m) => m.etaMin).filter((n): n is number => n != null);
  if (!hits.length) return null;
  let earliest = Math.min(...hits);
  let latest = Math.max(...hits);
  if (latest - earliest < SAMUI_NOWCAST_MIN_WINDOW_MIN) {
    const pad = (SAMUI_NOWCAST_MIN_WINDOW_MIN - (latest - earliest)) / 2;
    earliest = Math.max(0, earliest - pad);
    latest = Math.min(horizon, earliest + SAMUI_NOWCAST_MIN_WINDOW_MIN);
    if (latest - earliest < SAMUI_NOWCAST_MIN_WINDOW_MIN) {
      earliest = Math.max(0, latest - SAMUI_NOWCAST_MIN_WINDOW_MIN);
    }
  }
  if (!(latest > earliest)) return null;
  const earliestMin = Math.round(earliest * 10) / 10;
  const latestMin = Math.round(latest * 10) / 10;
  return {
    earliestMin,
    latestMin,
    earliestUnix: nowUnix + Math.round(earliestMin * 60),
    latestUnix: nowUnix + Math.round(latestMin * 60),
    source,
    horizonMin: horizon,
    spreadWidened,
    members,
  };
}

function brier(probs: number[], outcomes: number[]): number | null {
  if (!probs.length || probs.length !== outcomes.length) return null;
  let s = 0;
  for (let i = 0; i < probs.length; i++) s += (probs[i]! - outcomes[i]!) ** 2;
  return s / probs.length;
}

export function calibrationGate(
  samples: CalibrationSample[] | undefined,
  month: string,
  windBin: WindBin,
): CalibrationGate {
  const rows = (samples ?? []).filter((s) => s.month === month && s.windBin === windBin);
  const issuances = rows.length;
  const rainEvents = rows.filter((s) => s.observedRain).length;
  const base: CalibrationGate = {
    allow: false,
    reason: '',
    issuances,
    rainEvents,
    brierModel: null,
    brierCandidate: null,
    month,
    windBin,
  };
  if (issuances < SAMUI_NOWCAST_MIN_ISSUANCES) {
    base.reason = `Need at least ${SAMUI_NOWCAST_MIN_ISSUANCES} issuances in ${month} / ${windBin}; have ${issuances}.`;
    return base;
  }
  if (rainEvents < SAMUI_NOWCAST_MIN_RAIN_EVENTS) {
    base.reason = `Need at least ${SAMUI_NOWCAST_MIN_RAIN_EVENTS} rain events in ${month} / ${windBin}; have ${rainEvents}.`;
    return base;
  }
  const model = rows.map((s) => s.modelPopPct / 100);
  const candidate = rows.map((s) => s.candidatePopPct / 100);
  const observed = rows.map((s) => (s.observedRain ? 1 : 0));
  const brierModel = brier(model, observed);
  const brierCandidate = brier(candidate, observed);
  base.brierModel = brierModel;
  base.brierCandidate = brierCandidate;
  if (brierModel == null || brierCandidate == null || !(brierCandidate < brierModel)) {
    base.reason = 'Candidate Brier score does not beat the raw model.';
    return base;
  }
  base.allow = true;
  base.reason = 'Candidate Brier score beats the raw model for this month and wind bin.';
  return base;
}

function emptyHours(hours: NowcastHourInput[], nowUnix: number, annotate: boolean): NowcastHour[] {
  return hours.map((h) => {
    const leadHours = (h.validTimeUnix - nowUnix) / 3600;
    const inWindow = leadHours >= -1 && leadHours < SAMUI_NOWCAST_SHOWER_FLAG_LEAD_HOURS;
    return {
      validTimeUnix: h.validTimeUnix,
      leadHours,
      originalPopPct: h.popPct,
      publishedPopPct: h.popPct,
      candidatePopPct: null,
      calledDry: false,
      showerCanStillForm: false,
      rainInEtaWindow: false,
      touched: annotate && inWindow,
    };
  });
}

function applyClearHours(hours: NowcastHour[], publish: boolean): NowcastHour[] {
  return hours.map((h) => {
    if (h.leadHours >= SAMUI_NOWCAST_SHOWER_FLAG_LEAD_HOURS || h.leadHours < -1) {
      return { ...h, touched: false };
    }
    if (h.leadHours < SAMUI_NOWCAST_DRY_LEAD_HOURS) {
      const candidate = h.originalPopPct == null ? null : 0;
      return {
        ...h,
        touched: true,
        calledDry: true,
        candidatePopPct: candidate,
        publishedPopPct: publish && candidate != null ? 0 : h.originalPopPct,
      };
    }
    return { ...h, touched: true, showerCanStillForm: true };
  });
}

function applyEtaHours(hours: NowcastHour[], eta: NowcastEta): NowcastHour[] {
  const start = eta.earliestUnix;
  const end = eta.latestUnix;
  return hours.map((h) => {
    if (h.leadHours >= SAMUI_NOWCAST_SHOWER_FLAG_LEAD_HOURS || h.leadHours < -1) {
      return { ...h, touched: false };
    }
    const hourStart = h.validTimeUnix;
    const hourEnd = hourStart + 3600;
    const overlap = hourStart < end && hourEnd > start;
    return { ...h, touched: true, rainInEtaWindow: overlap };
  });
}

function finish(
  partial: Omit<NowcastDecision, 'hours' | 'publishLowering' | 'calibration' | 'stationWindUsedForSteering'> & {
    hours: NowcastHour[];
  },
  publishFlag: boolean,
  gate: CalibrationGate,
): NowcastDecision {
  const publishLowering = publishFlag && partial.state === 'clear' && gate.allow;
  const hours =
    partial.state === 'clear' ? applyClearHours(partial.hours, publishLowering) : partial.hours;
  return {
    ...partial,
    hours,
    publishLowering,
    calibration: gate,
    stationWindUsedForSteering: false,
  };
}

export function evaluateSamuiNowcast(input: EvaluateNowcastInput): NowcastDecision {
  const pin = input.pin ?? SAMUI_NOWCAST_PIN;
  const hoursIn = input.hours ?? [];
  const wind700 = cleanWind(input.wind700);
  const wind850 = cleanWind(input.wind850);
  const wind500 = cleanWind(input.wind500);
  const steering = selectSteeringWind(wind700, wind850, wind500);
  const surgeWind = wind700 ?? (steering && steering.source === '850-500hPa-mean' ? steering : null);
  const month = utcMonth(input.nowUnix);
  const windBin = wind700
    ? windBinFromDeg(wind700.fromDeg)
    : steering
      ? windBinFromDeg(steering.fromDeg)
      : 'unknown';
  const gate = calibrationGate(input.calibrationSamples, month, windBin);
  const publishFlag = input.publishCalibratedLowering === true;

  const blank = (state: NowcastState, reason: string, radarTime: number | null, age: number | null): NowcastDecision =>
    finish(
      {
        state,
        reason,
        radarTimeUnix: radarTime,
        radarAgeSec: age,
        eta: null,
        hours: emptyHours(hoursIn, input.nowUnix, false),
        cells: [],
      },
      publishFlag,
      gate,
    );

  if (input.scans == null) {
    return blank(
      'unavailable',
      'Radar catalog is missing. Model forecast left unchanged.',
      null,
      null,
    );
  }
  const past = genuinePast(input.scans);
  if (!past.length) {
    return blank(
      'unavailable',
      'No genuine radar frames. Model forecast left unchanged.',
      null,
      null,
    );
  }
  const latestScan = past[past.length - 1]!;
  const age = Math.max(0, input.nowUnix - latestScan.timeUnix);
  if (age > SAMUI_NOWCAST_STALE_SEC) {
    const minutes = Math.round(age / 60);
    return blank(
      'stale',
      `Latest radar scan is ${minutes} minutes old, older than 20 minutes. Adjustment skipped.`,
      latestScan.timeUnix,
      age,
    );
  }
  if (!input.reflectivityKnown) {
    return blank(
      'unavailable',
      'Reflectivity is missing, so no dry call and no ETA were made. Model forecast left unchanged.',
      latestScan.timeUnix,
      age,
    );
  }

  const tracks = linkCellTracks(past)
    .map((track) => analyzeTrack(track, pin))
    .filter((motion) => motion.latest.timeUnix === latestScan.timeUnix && motion.latest.dbz >= SAMUI_NOWCAST_ECHO_DBZ);
  const cells: NowcastCellView[] = tracks.map((motion) => ({
    lat: motion.latest.lat,
    lon: motion.latest.lon,
    dbz: motion.latest.dbz,
    areaKm2: motion.latest.areaKm2,
    nObs: motion.nObs,
    distanceKm: motion.distanceKm,
    growing: motion.growing,
  }));

  const station = stationSignals(input.station, input.nowUnix);
  const annotated = emptyHours(hoursIn, input.nowUnix, true);

  const developingReason = (): string | null => {
    if (tracks.some((m) => m.nObs === 1 && m.distanceKm <= SAMUI_NOWCAST_NEW_CELL_KM)) {
      return 'Developing: new cell within 50 km. No ETA.';
    }
    if (tracks.some((m) => m.growing && m.distanceKm <= SAMUI_NOWCAST_NEW_CELL_KM)) {
      return 'Developing: growing cell within 50 km. No ETA.';
    }
    if (isNeMonsoonSurge(surgeWind)) return 'Developing: northeast monsoon surge. No ETA.';
    if (station.gustFront) return 'Developing: Ecowitt gust front. No ETA.';
    if (station.tempDrop) return 'Developing: Ecowitt temperature drop. No ETA.';
    return null;
  };

  const dev = developingReason();
  if (dev) {
    return finish(
      {
        state: 'developing',
        reason: dev,
        radarTimeUnix: latestScan.timeUnix,
        radarAgeSec: age,
        eta: null,
        hours: annotated,
        cells,
      },
      publishFlag,
      gate,
    );
  }

  const echoInWatch = tracks.some((m) => inWatch(pin, m.latest, wind700));
  const growthInWatch = tracks.some((m) => m.growing && inWatch(pin, m.latest, wind700));
  const coverage = input.coverageRadiusKm;
  const radius = wind700 ? upstreamRadiusKm(wind700.speedMps) : null;
  const coverageShort = radius != null && (coverage == null || coverage + 1e-6 < radius);

  let clearBlock: string | null = null;
  if (!wind700) {
    clearBlock = '700 hPa wind is missing, so the clear-radar check was not applied.';
  } else if (growthInWatch) {
    clearBlock = 'Not clear: growth trend in the watch region.';
  } else if (echoInWatch) {
    clearBlock = 'Not clear: >=20 dBZ echo inside the upstream radius or the 30 km ring.';
  } else if (coverageShort) {
    clearBlock = 'Not clear: the radar tile does not cover the upstream radius.';
  }

  let best: { motion: TrackMotion; eta: NowcastEta } | null = null;
  let neededWind = false;
  for (const motion of tracks) {
    if (motion.quality !== 'ok' && !steering) neededWind = true;
    const eta = buildEta(motion, pin, steering, input.nowUnix);
    if (!eta) continue;
    if (!best || eta.earliestMin < best.eta.earliestMin) best = { motion, eta };
  }

  if (!clearBlock && !best) {
    return finish(
      {
        state: 'clear',
        reason:
          'Clear radar: no >=20 dBZ echo in the upstream watch or the 30 km ring, no new cell within 50 km, and no growth. Next 2 hours called dry; that lowering is not published unless the calibration flag is on.',
        radarTimeUnix: latestScan.timeUnix,
        radarAgeSec: age,
        eta: null,
        hours: annotated,
        cells,
      },
      publishFlag,
      gate,
    );
  }

  if (best) {
    const via =
      best.eta.source === 'tracked'
        ? 'tracked motion'
        : best.eta.source === '700hPa'
          ? '700 hPa wind'
          : 'the 850-500 hPa mean wind';
    return finish(
      {
        state: 'approaching',
        reason: `Approaching cell. ETA window from ${via}.`,
        radarTimeUnix: latestScan.timeUnix,
        radarAgeSec: age,
        eta: best.eta,
        hours: applyEtaHours(annotated, best.eta),
        cells,
      },
      publishFlag,
      gate,
    );
  }

  const reason = neededWind
    ? 'Cell motion is too weak to track and steering wind is missing. Model forecast left unchanged.'
    : clearBlock
      ? `${clearBlock} Model forecast left unchanged.`
      : 'No cell reaches Koh Samui inside the nowcast horizon. Model forecast left unchanged.';
  return finish(
    {
      state: 'no_eta',
      reason,
      radarTimeUnix: latestScan.timeUnix,
      radarAgeSec: age,
      eta: null,
      hours: annotated,
      cells,
    },
    publishFlag,
    gate,
  );
}

export function publishFlagFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NOWCAST_PUBLISH_CALIBRATED_LOWERING === '1';
}

export type ReplayLeadBand = '0-30' | '30-60' | '60-120' | '120-360';

export type ReplayCase = {
  leadBand: ReplayLeadBand;
  forecastRain: boolean;
  observedRain: boolean;
  etaEarliestUnix?: number | null;
  etaLatestUnix?: number | null;
  observedOnsetUnix?: number | null;
};

export type ReplayContingency = {
  n: number;
  hits: number;
  misses: number;
  falseAlarms: number;
  correctNegatives: number;
  /** POD = hits / (hits + misses). */
  hitRate: number | null;
  /** False alarm rate = false alarms / (false alarms + correct negatives). */
  falseAlarmRate: number | null;
  /** False alarm ratio = false alarms / (hits + false alarms). */
  falseAlarmRatio: number | null;
  csi: number | null;
};

export type ReplayReport = {
  byLead: Record<ReplayLeadBand, ReplayContingency>;
  eta: { n: number; medianMin: number; q25Min: number; q75Min: number; iqrMin: number } | null;
};

const LEAD_BANDS: ReplayLeadBand[] = ['0-30', '30-60', '60-120', '120-360'];

function contingency(cases: ReplayCase[]): ReplayContingency {
  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;
  let correctNegatives = 0;
  for (const c of cases) {
    if (c.forecastRain && c.observedRain) hits++;
    else if (!c.forecastRain && c.observedRain) misses++;
    else if (c.forecastRain && !c.observedRain) falseAlarms++;
    else correctNegatives++;
  }
  const ratio = (num: number, den: number) => (den > 0 ? num / den : null);
  return {
    n: cases.length,
    hits,
    misses,
    falseAlarms,
    correctNegatives,
    hitRate: ratio(hits, hits + misses),
    falseAlarmRate: ratio(falseAlarms, falseAlarms + correctNegatives),
    falseAlarmRatio: ratio(falseAlarms, hits + falseAlarms),
    csi: ratio(hits, hits + misses + falseAlarms),
  };
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - idx) + sorted[hi]! * (idx - lo);
}

/** Gauge replay: hit rate, false alarm rate, CSI by lead band, and ETA error median / IQR. */
export function scoreNowcastReplay(cases: ReplayCase[]): ReplayReport {
  const byLead = {} as Record<ReplayLeadBand, ReplayContingency>;
  for (const band of LEAD_BANDS) {
    byLead[band] = contingency(cases.filter((c) => c.leadBand === band));
  }
  const errors: number[] = [];
  for (const c of cases) {
    if (c.etaEarliestUnix == null || c.etaLatestUnix == null || c.observedOnsetUnix == null) continue;
    const mid = (c.etaEarliestUnix + c.etaLatestUnix) / 2;
    errors.push((mid - c.observedOnsetUnix) / 60);
  }
  if (!errors.length) return { byLead, eta: null };
  errors.sort((a, b) => a - b);
  const q25 = quantile(errors, 0.25);
  const q75 = quantile(errors, 0.75);
  return {
    byLead,
    eta: {
      n: errors.length,
      medianMin: quantile(errors, 0.5),
      q25Min: q25,
      q75Min: q75,
      iqrMin: q75 - q25,
    },
  };
}

export function historicReplayGap(): { ready: false; missing: string[] } {
  return {
    ready: false,
    missing: [
      'No radar-cell archive exists yet. RainViewer weather-maps.json keeps about 2 hours of past frames, and this repo has no 30-day radar deleter to extend.',
      'Ecowitt gauge minutes live in Supabase ecowitt_observations. This run has no SUPABASE_URL, so they were not read.',
      'Spire hourly probabilities live in weather_forecast / weather_history / weather_forecast_snapshot. Those rows were not read here either.',
      'Brier skill by month and wind bin needs at least 30 issuances and 5 rain events. That sample is not in the repository.',
    ],
  };
}
