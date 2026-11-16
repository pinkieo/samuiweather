import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { latLonToRainviewerTileFraction, RAINVIEWER_NATIVE_Z } from '../lib/rainviewer-tile-math';
import {
  dbzFromUniversalBlue,
  parseRainViewerMaps,
  scanTileReflectivity,
} from '../lib/samui-nowcast-radar';
import {
  evaluateSamuiNowcast,
  historicReplayGap,
  readSpireLevelWind,
  SAMUI_NOWCAST_PIN,
  scoreNowcastReplay,
  selectSteeringWind,
  utcMonth,
  type CalibrationSample,
  type EvaluateNowcastInput,
  type RadarCell,
  type RadarScan,
  type WindBin,
} from '../lib/samui-nowcast';

const NOW = Math.floor(Date.UTC(2026, 10, 16, 6, 0, 0) / 1000);
const MONTH = utcMonth(NOW);

function offset(eastKm: number, northKm: number): { lat: number; lon: number } {
  const lat = SAMUI_NOWCAST_PIN.lat + northKm / 110.574;
  const lon =
    SAMUI_NOWCAST_PIN.lon +
    eastKm / (111.32 * Math.cos((SAMUI_NOWCAST_PIN.lat * Math.PI) / 180));
  return { lat, lon };
}

function cell(eastKm: number, northKm: number, dbz = 30, areaKm2 = 20): RadarCell {
  return { ...offset(eastKm, northKm), dbz, areaKm2 };
}

function hours() {
  return [-2, 0, 0.5, 1, 3, 8].map((lead) => ({
    validTimeUnix: NOW + lead * 3600,
    popPct: 40,
  }));
}

function at(decision: ReturnType<typeof evaluateSamuiNowcast>, lead: number) {
  const hour = decision.hours.find((h) => Math.abs(h.leadHours - lead) < 0.02);
  assert.ok(hour, `missing hour at lead ${lead}`);
  return hour;
}

const west8 = { speedMps: 8, fromDeg: 270 };

function base(
  over: Partial<Omit<EvaluateNowcastInput, 'nowUnix' | 'scans'>> & {
    scans: RadarScan[] | null;
  },
) {
  return evaluateSamuiNowcast({
    hours: hours(),
    reflectivityKnown: true,
    coverageRadiusKm: 400,
    ...over,
    nowUnix: NOW,
  });
}

function track(
  startEast: number,
  endEast: number,
  frames: number,
  areaKm2: number,
  dbz: number | number[] = 30,
  stepSec = 600,
): RadarScan[] {
  const last = NOW - 90;
  const scans: RadarScan[] = [];
  for (let i = 0; i < frames; i++) {
    const km = startEast + ((endEast - startEast) * i) / Math.max(1, frames - 1);
    const echo = Array.isArray(dbz) ? dbz[i]! : dbz;
    scans.push({
      timeUnix: last - (frames - 1 - i) * stepSec,
      kind: 'past',
      cells: [cell(km, 0, echo, areaKm2)],
    });
  }
  return scans;
}

function skillSamples(rains: number, total: number, bin: WindBin = 'W'): CalibrationSample[] {
  return Array.from({ length: total }, (_, i) => {
    const observedRain = i < rains;
    return {
      month: MONTH,
      windBin: bin,
      modelPopPct: 40,
      candidatePopPct: observedRain ? 40 : 0,
      observedRain,
    };
  });
}

describe('samui nowcast rules', () => {
  it('skips a radar scan older than 20 minutes and leaves every hour unchanged', () => {
    const decision = base({
      scans: [{ timeUnix: NOW - 21 * 60, kind: 'past', cells: [] }],
      wind700: west8,
    });
    assert.equal(decision.state, 'stale');
    assert.match(decision.reason, /older than 20 minutes/);
    assert.equal(decision.eta, null);
    for (const hour of decision.hours) {
      assert.equal(hour.publishedPopPct, hour.originalPopPct);
      assert.equal(hour.calledDry, false);
      assert.equal(hour.showerCanStillForm, false);
      assert.equal(hour.touched, false);
    }
  });

  it('does not let a RainViewer nowcast product refresh a stale scan', () => {
    const decision = base({
      scans: [
        { timeUnix: NOW - 25 * 60, kind: 'past', cells: [] },
        { timeUnix: NOW - 60, kind: 'nowcast', cells: [cell(-10, 0)] },
      ],
      wind700: west8,
    });
    assert.equal(decision.state, 'stale');
  });

  it('leaves the model untouched when radar or reflectivity is missing', () => {
    const missing = base({ scans: null, reflectivityKnown: false, wind700: west8 });
    assert.equal(missing.state, 'unavailable');
    assert.match(missing.reason, /Model forecast left unchanged/);
    assert.equal(at(missing, 1).publishedPopPct, 40);

    const noDbz = base({
      scans: [{ timeUnix: NOW - 120, kind: 'past', cells: [] }],
      reflectivityKnown: false,
      wind700: west8,
    });
    assert.equal(noDbz.state, 'unavailable');
    assert.match(noDbz.reason, /Reflectivity is missing/);
    assert.equal(at(noDbz, 1).calledDry, false);
  });

  it('calls only the next 2 hours dry on clear radar and does not publish the lower number', () => {
    const decision = base({
      scans: [{ timeUnix: NOW - 5 * 60, kind: 'past', cells: [] }],
      wind700: west8,
      publishCalibratedLowering: false,
      calibrationSamples: skillSamples(5, 30),
    });
    assert.equal(decision.state, 'clear');
    assert.equal(decision.publishLowering, false);
    assert.equal(decision.stationWindUsedForSteering, false);
    const soon = at(decision, 1);
    assert.equal(soon.calledDry, true);
    assert.equal(soon.candidatePopPct, 0);
    assert.equal(soon.publishedPopPct, 40);
    assert.equal(soon.showerCanStillForm, false);
    const later = at(decision, 3);
    assert.equal(later.calledDry, false);
    assert.equal(later.showerCanStillForm, true);
    assert.equal(later.publishedPopPct, 40);
    assert.equal(later.candidatePopPct, null);
    const beyond = at(decision, 8);
    assert.equal(beyond.touched, false);
    assert.equal(beyond.calledDry, false);
    assert.equal(beyond.showerCanStillForm, false);
    assert.equal(beyond.publishedPopPct, 40);
    assert.equal(at(decision, -2).touched, false);
  });

  it('keeps a downwind echo outside the 30 km ring from blocking a clear call', () => {
    const decision = base({
      scans: [{ timeUnix: NOW - 120, kind: 'past', cells: [cell(80, 0, 25, 10)] }],
      wind700: west8,
    });
    assert.equal(decision.state, 'clear');
  });

  it('blocks clear when a >=20 dBZ echo sits in the upstream radius', () => {
    const decision = base({
      scans: track(-70, -60, 2, 20, 25),
      wind700: west8,
    });
    assert.notEqual(decision.state, 'clear');
    assert.match(decision.reason, /upstream radius|30 km ring|growth/);
    assert.equal(at(decision, 1).calledDry, false);
    assert.equal(at(decision, 1).publishedPopPct, 40);
  });

  it('blocks clear for a steady echo inside the 30 km ring', () => {
    const decision = base({
      scans: [
        { timeUnix: NOW - 700, kind: 'past', cells: [cell(25, 0, 22, 15)] },
        { timeUnix: NOW - 100, kind: 'past', cells: [cell(25, 0, 22, 15)] },
      ],
      wind700: west8,
    });
    assert.equal(decision.state, 'no_eta');
    assert.match(decision.reason, /30 km ring|upstream radius/);
    assert.equal(decision.eta, null);
    assert.equal(at(decision, 8).touched, false);
  });

  it('blocks clear on a growth trend outside 50 km', () => {
    const decision = base({
      scans: track(-60, -60, 2, 30, [20, 28]),
      wind700: west8,
    });
    assert.equal(decision.state, 'no_eta');
    assert.match(decision.reason, /growth trend/);
    assert.equal(at(decision, 3).showerCanStillForm, false);
  });

  it('does not call clear when the tile cannot cover the upstream radius', () => {
    const decision = base({
      scans: [{ timeUnix: NOW - 120, kind: 'past', cells: [] }],
      wind700: { speedMps: 20, fromDeg: 270 },
      coverageRadiusKm: 10,
    });
    assert.notEqual(decision.state, 'clear');
    assert.match(decision.reason, /does not cover the upstream radius/);
  });

  it('does not call clear without 700 hPa wind', () => {
    const decision = base({
      scans: [{ timeUnix: NOW - 120, kind: 'past', cells: [] }],
      wind850: { speedMps: 10, fromDeg: 270 },
      wind500: { speedMps: 10, fromDeg: 270 },
    });
    assert.equal(decision.state, 'no_eta');
    assert.match(decision.reason, /700 hPa wind is missing/);
    assert.equal(at(decision, 1).publishedPopPct, 40);
  });

  it('treats a new cell within 50 km as developing and shows no ETA', () => {
    const decision = base({
      scans: [{ timeUnix: NOW - 60, kind: 'past', cells: [cell(-15, 0, 35, 12)] }],
      wind700: west8,
    });
    assert.equal(decision.state, 'developing');
    assert.match(decision.reason, /new cell within 50 km/);
    assert.equal(decision.eta, null);
    assert.equal(at(decision, 1).calledDry, false);
    assert.equal(at(decision, 1).publishedPopPct, 40);
  });

  it('treats a growing cell within 50 km as developing and suppresses the ETA', () => {
    const decision = base({
      scans: track(-50, -20, 4, 25, [20, 24, 28, 34]),
      wind700: west8,
    });
    assert.equal(decision.state, 'developing');
    assert.match(decision.reason, /growing cell within 50 km/);
    assert.equal(decision.eta, null);
  });

  it('lets an NE monsoon surge override a tracked ETA', () => {
    const decision = base({
      scans: track(-40, -10, 4, 20),
      wind700: { speedMps: 14, fromDeg: 45 },
    });
    assert.equal(decision.state, 'developing');
    assert.match(decision.reason, /northeast monsoon surge/);
    assert.equal(decision.eta, null);
  });

  it('uses an Ecowitt gust or temperature drop as developing, not as steering', () => {
    const scans = track(-40, -10, 4, 20);
    const gust = base({
      scans,
      wind700: west8,
      station: [
        {
          timeUnix: NOW - 600,
          tempC: 29,
          windSpeedMs: 3,
          windGustMs: 10,
          windFromDeg: 0,
        },
      ],
    });
    assert.equal(gust.state, 'developing');
    assert.match(gust.reason, /gust front/);
    assert.equal(gust.eta, null);
    assert.equal(gust.stationWindUsedForSteering, false);

    const drop = base({
      scans,
      wind700: west8,
      station: [
        { timeUnix: NOW - 1200, tempC: 31, windSpeedMs: 2, windGustMs: 3, windFromDeg: 180 },
        { timeUnix: NOW - 300, tempC: 28.5, windSpeedMs: 2, windGustMs: 3, windFromDeg: 180 },
      ],
    });
    assert.equal(drop.state, 'developing');
    assert.match(drop.reason, /temperature drop/);
    assert.equal(drop.eta, null);
  });

  it('builds a 9-member tracked ETA window and leaves hours past 6 h alone', () => {
    const decision = base({
      scans: track(-40, -10, 4, 20),
      wind700: { speedMps: 60 / 3.6, fromDeg: 270 },
    });
    assert.equal(decision.state, 'approaching');
    assert.match(decision.reason, /tracked motion/);
    const eta = decision.eta;
    assert.ok(eta);
    assert.equal(eta.source, 'tracked');
    assert.equal(eta.members.length, 9);
    assert.equal(eta.horizonMin, 60);
    assert.equal(eta.spreadWidened, false);
    assert.ok(eta.latestUnix > eta.earliestUnix);
    assert.ok(eta.latestMin - eta.earliestMin >= 10);
    assert.equal(at(decision, 0).rainInEtaWindow, true);
    assert.equal(at(decision, 0).publishedPopPct, 40);
    assert.equal(at(decision, 0).calledDry, false);
    assert.equal(at(decision, 8).touched, false);
    assert.equal(at(decision, 8).rainInEtaWindow, false);
  });

  it('uses a 2 hour horizon only for an organised line tracked on at least 4 frames', () => {
    const line = base({
      scans: track(-100, -80, 4, 500),
      wind700: { speedMps: 40 / 3.6, fromDeg: 270 },
    });
    assert.equal(line.state, 'approaching');
    assert.equal(line.eta?.horizonMin, 120);
    assert.equal(line.eta?.source, 'tracked');

    const isolated = base({
      scans: track(-100, -80, 4, 20),
      wind700: { speedMps: 40 / 3.6, fromDeg: 270 },
    });
    assert.equal(isolated.eta, null);
    assert.notEqual(isolated.state, 'approaching');
  });

  it('falls back to 700 hPa when fewer than 3 frames, the cell is slow, or the track is poor', () => {
    const few = base({
      scans: track(-30, -20, 2, 20),
      wind700: { speedMps: 10, fromDeg: 270 },
      station: [
        { timeUnix: NOW - 300, tempC: 29, windSpeedMs: 20, windGustMs: 21, windFromDeg: 0 },
      ],
    });
    assert.equal(few.state, 'approaching');
    assert.equal(few.eta?.source, '700hPa');
    assert.equal(few.stationWindUsedForSteering, false);
    const towardEast = few.eta!.members.some((m) => {
      const d = Math.abs((((m.directionToDeg - 90) % 360) + 360) % 360);
      return Math.min(d, 360 - d) < 20;
    });
    assert.equal(towardEast, true);

    const slow = base({
      scans: track(-22, -20, 3, 20, 30, 1000),
      wind700: { speedMps: 10, fromDeg: 270 },
    });
    assert.equal(slow.eta?.source, '700hPa');

    const poor = base({
      scans: [
        { timeUnix: NOW - 1890, kind: 'past', cells: [cell(-40, 0)] },
        { timeUnix: NOW - 990, kind: 'past', cells: [cell(-20, 25)] },
        { timeUnix: NOW - 90, kind: 'past', cells: [cell(-10, 0)] },
      ],
      wind700: { speedMps: 10, fromDeg: 270 },
    });
    assert.equal(poor.eta?.source, '700hPa');
    assert.notEqual(poor.state, 'developing');
  });

  it('uses the 850-500 hPa mean when 700 hPa is missing and does not steer on Ecowitt alone', () => {
    const mean = selectSteeringWind(
      null,
      { speedMps: 10, fromDeg: 90 },
      { speedMps: 10, fromDeg: 0 },
    );
    assert.equal(mean?.source, '850-500hPa-mean');
    assert.deepEqual(mean?.levels, ['850hPa', '500hPa']);
    assert.ok(mean && Math.abs(mean.fromDeg - 45) < 1);
    const only850 = selectSteeringWind(null, { speedMps: 10, fromDeg: 270 }, null);
    assert.equal(only850?.source, '850hPa');
    assert.deepEqual(only850?.levels, ['850hPa']);

    const decision = base({
      scans: track(-30, -20, 2, 20),
      wind850: { speedMps: 10, fromDeg: 270 },
      wind500: { speedMps: 10, fromDeg: 270 },
      station: [
        { timeUnix: NOW - 200, tempC: 29, windSpeedMs: 18, windGustMs: 19, windFromDeg: 0 },
      ],
    });
    assert.equal(decision.eta?.source, '850-500hPa-mean');

    const surfaceOnly = base({
      scans: track(-30, -20, 2, 20),
      station: [
        { timeUnix: NOW - 200, tempC: 29, windSpeedMs: 18, windGustMs: 19, windFromDeg: 270 },
      ],
    });
    assert.equal(surfaceOnly.eta, null);
    assert.match(surfaceOnly.reason, /steering wind is missing|700 hPa wind is missing/);
    assert.equal(at(surfaceOnly, 1).publishedPopPct, 40);
  });

  it('widens the ensemble when radar and model motion disagree', () => {
    const scans = track(-40, -10, 4, 20);
    const agree = base({
      scans,
      wind700: { speedMps: 60 / 3.6, fromDeg: 270 },
    });
    const turned = base({
      scans,
      wind700: { speedMps: 60 / 3.6, fromDeg: 0 },
    });
    const slowed = base({
      scans,
      wind700: { speedMps: 10 / 3.6, fromDeg: 270 },
    });
    assert.equal(agree.eta?.spreadWidened, false);
    assert.equal(turned.eta?.spreadWidened, true);
    assert.equal(slowed.eta?.spreadWidened, true);
    const width = (d: typeof agree) => (d.eta ? d.eta.latestMin - d.eta.earliestMin : 0);
    assert.ok(width(turned) > width(agree));
    assert.ok(width(slowed) > width(agree));
    assert.equal(turned.eta?.members.length, 9);
  });

  it('publishes a dry-call zero only when the flag is on and the Brier gate passes', () => {
    const scene = {
      scans: [{ timeUnix: NOW - 5 * 60, kind: 'past' as const, cells: [] }],
      wind700: west8,
    };
    const withheld = base({
      ...scene,
      publishCalibratedLowering: false,
      calibrationSamples: skillSamples(5, 30),
    });
    assert.equal(withheld.publishLowering, false);
    assert.equal(at(withheld, 1).publishedPopPct, 40);
    assert.equal(withheld.calibration.allow, true);

    const shortRecord = base({
      ...scene,
      publishCalibratedLowering: true,
      calibrationSamples: skillSamples(5, 12),
    });
    assert.equal(shortRecord.publishLowering, false);
    assert.match(shortRecord.calibration.reason, /30 issuances/);
    assert.equal(at(shortRecord, 1).publishedPopPct, 40);

    const fewRains = base({
      ...scene,
      publishCalibratedLowering: true,
      calibrationSamples: skillSamples(2, 30),
    });
    assert.equal(fewRains.publishLowering, false);
    assert.match(fewRains.calibration.reason, /5 rain events/);

    const open = base({
      ...scene,
      publishCalibratedLowering: true,
      calibrationSamples: skillSamples(5, 30),
    });
    assert.equal(open.publishLowering, true);
    assert.equal(at(open, 1).publishedPopPct, 0);
    assert.equal(at(open, 1).candidatePopPct, 0);
    assert.equal(at(open, 3).publishedPopPct, 40);
    assert.equal(at(open, 3).showerCanStillForm, true);
    assert.equal(at(open, 8).publishedPopPct, 40);
    assert.equal(at(open, 8).touched, false);
  });
});

describe('samui nowcast replay and radar fixtures', () => {
  it('scores hit rate, false alarm rate, CSI, and ETA error median and IQR', () => {
    const report = scoreNowcastReplay([
      { leadBand: '0-30', forecastRain: true, observedRain: true, etaEarliestUnix: 1000, etaLatestUnix: 1600, observedOnsetUnix: 1300 },
      { leadBand: '0-30', forecastRain: true, observedRain: false, etaEarliestUnix: 1000, etaLatestUnix: 1600, observedOnsetUnix: 2000 },
      { leadBand: '0-30', forecastRain: false, observedRain: true },
      { leadBand: '0-30', forecastRain: false, observedRain: false },
      { leadBand: '60-120', forecastRain: true, observedRain: true },
    ]);
    const band = report.byLead['0-30'];
    assert.equal(band.hits, 1);
    assert.equal(band.misses, 1);
    assert.equal(band.falseAlarms, 1);
    assert.equal(band.correctNegatives, 1);
    assert.equal(band.hitRate, 0.5);
    assert.equal(band.falseAlarmRate, 0.5);
    assert.equal(band.csi, 1 / 3);
    assert.equal(report.byLead['60-120'].csi, 1);
    assert.equal(report.byLead['30-60'].n, 0);
    assert.ok(report.eta);
    assert.equal(report.eta.n, 2);
    assert.equal(report.eta.iqrMin, report.eta.q75Min - report.eta.q25Min);
  });

  it('reports the historic replay gap when gauge and radar archives are not available', () => {
    const gap = historicReplayGap();
    assert.equal(gap.ready, false);
    assert.ok(gap.missing.some((line) => /Ecowitt/.test(line)));
    assert.ok(gap.missing.some((line) => /30-day/.test(line)));
  });

  it('reads a recorded RainViewer catalog and ignores non-palette colors', () => {
    const raw = JSON.parse(
      readFileSync(new URL('./fixtures/rainviewer-weather-maps-2026-11-16.json', import.meta.url), 'utf8'),
    );
    const catalog = parseRainViewerMaps(raw);
    assert.ok(catalog.past.length >= 3);
    assert.ok(catalog.past[catalog.past.length - 1]!.time - catalog.past[0]!.time >= 30 * 60);
    assert.equal(catalog.past.every((frame) => frame.kind === 'past'), true);
    assert.equal(catalog.generatedUnix, 1794809424);
    const withProduct = parseRainViewerMaps({
      radar: {
        past: [{ path: '/v2/radar/a', time: 100 }],
        nowcast: [{ path: '/v2/radar/b', time: 200 }],
      },
    });
    assert.equal(withProduct.nowcast[0]!.kind, 'nowcast');
    assert.equal(withProduct.past.length, 1);

    assert.equal(dbzFromUniversalBlue(0, 163, 224, 255), 20);
    assert.equal(dbzFromUniversalBlue(0, 163, 224, 10), null);
    assert.equal(dbzFromUniversalBlue(9, 9, 9, 255), null);

    const { xTile, yTile } = latLonToRainviewerTileFraction(
      SAMUI_NOWCAST_PIN.lat,
      SAMUI_NOWCAST_PIN.lon,
      RAINVIEWER_NATIVE_Z,
    );
    const width = 8;
    const height = 8;
    const rgba = new Uint8Array(width * height * 4);
    const paint = (x: number, y: number, r: number, g: number, b: number) => {
      const o = (y * width + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    };
    paint(1, 1, 136, 221, 238);
    const light = scanTileReflectivity({ rgba, width, height, xTile, yTile });
    assert.equal(light.cells.length, 0);
    assert.equal(light.matchedPixels, 1);
    paint(2, 2, 0, 163, 224);
    paint(3, 2, 0, 163, 224);
    const heavy = scanTileReflectivity({ rgba, width, height, xTile, yTile });
    assert.equal(heavy.cells.length, 1);
    assert.equal(heavy.cells[0]!.dbz, 20);
  });

  it('does not treat surface Spire wind as a 700 hPa vector', () => {
    assert.equal(
      readSpireLevelWind({ wind_speed: 6, wind_direction: 40 }, '700'),
      null,
    );
    const level = readSpireLevelWind({ u_wind_700hpa: -10, v_wind_700hpa: 0 }, '700');
    assert.ok(level);
    assert.ok(Math.abs(level.speedMps - 10) < 0.01);
    assert.ok(Math.abs(level.fromDeg - 90) < 0.01);
  });
});
