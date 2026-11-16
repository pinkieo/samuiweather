import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  fetchOpenMeteoSteering,
  kmhToMps,
  openMeteoSteeringUrl,
  parseOpenMeteoSteering,
  steeringBlockForValidTime,
  steeringVectorsFromValues,
  withOpenMeteoSteering,
} from '../lib/open-meteo-steering';
import { evaluateSamuiNowcast, selectSteeringWind } from '../lib/samui-nowcast';

const FETCHED = '2026-11-16T06:10:00.000Z';
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/open-meteo-steering-2026-11-16.json', import.meta.url), 'utf8'),
);
const errorFixture = JSON.parse(
  readFileSync(new URL('./fixtures/open-meteo-steering-error.json', import.meta.url), 'utf8'),
);

describe('Open-Meteo pressure-level wind', () => {
  it('reads the recorded km/h response and converts 700 hPa for steering', () => {
    const parsed = parseOpenMeteoSteering(fixture, FETCHED);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const first = parsed.hours[0]!;
    assert.equal(first.source, 'open-meteo');
    assert.equal(first.wind_speed_unit, 'km/h');
    assert.equal(first.wind_direction_unit, 'degrees');
    assert.equal(first.fetched_at_utc, FETCHED);
    assert.equal(first.requested_latitude, 9.56);
    assert.equal(first.requested_longitude, 100.03);
    assert.equal(first.wind_speed_700hpa_kmh, 16.3);
    assert.equal(first.wind_direction_700hpa_deg, 99);
    assert.equal(first.wind_speed_850hpa_kmh, 8.8);
    assert.equal(first.wind_direction_850hpa_deg, 28);
    assert.equal(first.wind_speed_500hpa_kmh, 26.8);
    assert.equal(first.wind_direction_500hpa_deg, 100);
    assert.deepEqual(first.levels_present, ['700hPa', '850hPa', '500hPa']);

    const block = steeringBlockForValidTime(parsed, '2026-11-16T01:00:00.000Z');
    assert.equal('error' in block, false);
    const values = withOpenMeteoSteering({ probability_of_precipitation_1hr: 40 }, block);
    assert.equal(values.probability_of_precipitation_1hr, 40);
    const winds = steeringVectorsFromValues(values);
    assert.equal(winds.fromOpenMeteo, true);
    assert.deepEqual(winds.levels, ['700hPa', '850hPa', '500hPa']);
    assert.ok(winds.wind700);
    assert.ok(Math.abs(winds.wind700.speedMps - kmhToMps(17.8)) < 1e-9);
    assert.equal(winds.wind700.fromDeg, 102);
    const steering = selectSteeringWind(winds.wind700, winds.wind850, winds.wind500);
    assert.equal(steering?.source, '700hPa');
    assert.deepEqual(steering?.levels, ['700hPa']);
  });

  it('uses 850 hPa alone when 700 and 500 are absent and does not invent a zero', () => {
    const body = structuredClone(fixture);
    body.hourly.wind_speed_700hPa = [null, null, null];
    body.hourly.wind_direction_700hPa = [null, null, null];
    body.hourly.wind_speed_500hPa = [null, null, null];
    body.hourly.wind_direction_500hPa = [null, null, null];
    const parsed = parseOpenMeteoSteering(body, FETCHED);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.hours[0]!.levels_present, ['850hPa']);
    assert.equal(parsed.hours[0]!.wind_speed_700hpa_kmh, null);
    const winds = steeringVectorsFromValues(
      withOpenMeteoSteering({}, parsed.hours[0]!),
    );
    assert.equal(winds.wind700, null);
    assert.equal(winds.wind500, null);
    assert.ok(winds.wind850);
    const steering = selectSteeringWind(null, winds.wind850, null);
    assert.equal(steering?.source, '850hPa');
    assert.deepEqual(steering?.levels, ['850hPa']);
  });

  it('rejects an error body, a non-km/h unit, and a failed HTTP call', async () => {
    const failed = parseOpenMeteoSteering(errorFixture, FETCHED);
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.failure.error, 'wind missing');
    assert.match(failed.reason, /hourly/);
    const values = withOpenMeteoSteering({ probability_of_precipitation_1hr: 55 }, failed.failure);
    assert.equal(values.probability_of_precipitation_1hr, 55);
    const winds = steeringVectorsFromValues(values);
    assert.equal(winds.fromOpenMeteo, false);
    assert.equal(winds.wind700, null);

    const wrongUnit = structuredClone(fixture);
    wrongUnit.hourly_units.wind_speed_700hPa = 'm/s';
    const rejected = parseOpenMeteoSteering(wrongUnit, FETCHED);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.reason, /km\/h/);

    const http = await fetchOpenMeteoSteering({
      now: new Date(FETCHED),
      fetchImpl: async () => new Response('nope', { status: 502 }),
    });
    assert.equal(http.ok, false);
    if (!http.ok) assert.match(http.reason, /Wind missing/);

    const thrown = await fetchOpenMeteoSteering({
      now: new Date(FETCHED),
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    assert.equal(thrown.ok, false);
    if (!thrown.ok) assert.match(thrown.reason, /network down/);
    assert.match(openMeteoSteeringUrl(), /wind_speed_unit=kmh/);
    assert.match(openMeteoSteeringUrl(), /latitude=9\.56/);
  });

  it('leaves the model rain chance unchanged when the steering fetch failed', () => {
    const failed = parseOpenMeteoSteering(errorFixture, FETCHED);
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    const winds = steeringVectorsFromValues(withOpenMeteoSteering({}, failed.failure));
    const now = Math.floor(Date.UTC(2026, 10, 16, 6, 0, 0) / 1000);
    const decision = evaluateSamuiNowcast({
      nowUnix: now,
      scans: [{ timeUnix: now - 120, kind: 'past', cells: [] }],
      reflectivityKnown: true,
      coverageRadiusKm: 400,
      wind700: winds.wind700,
      wind850: winds.wind850,
      wind500: winds.wind500,
      station: [
        { timeUnix: now - 300, tempC: 29, windSpeedMs: 20, windGustMs: 21, windFromDeg: 270 },
      ],
      hours: [{ validTimeUnix: now + 3600, popPct: 40 }],
    });
    assert.match(decision.reason, /wind missing|700 hPa wind is missing/i);
    assert.equal(decision.hours[0]!.publishedPopPct, 40);
    assert.equal(decision.stationWindUsedForSteering, false);
    assert.deepEqual(decision.steeringLevels, []);
  });
});
