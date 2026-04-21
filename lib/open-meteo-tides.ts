/**
 * Fallback when SPIRE `/tides/point` returns no usable hourly samples.
 * Open-Meteo Marine: global Copernicus-based sea level incl. tides (8 km; not for navigation).
 * @see https://open-meteo.com/en/docs/marine-weather-api — variable `sea_level_height_msl`
 */

const OPEN_METEO_MARINE = 'https://marine-api.open-meteo.com/v1/marine';

export async function fetchOpenMeteoTidesAsSpireShape(
  lat: number,
  lon: number,
): Promise<Record<string, unknown> | null> {
  const u = new URL(OPEN_METEO_MARINE);
  u.searchParams.set('latitude', String(lat));
  u.searchParams.set('longitude', String(lon));
  u.searchParams.set('hourly', 'sea_level_height_msl');
  /** ~120 h to match Spire tide horizon. */
  u.searchParams.set('forecast_days', '5');
  u.searchParams.set('timeformat', 'unixtime');
  u.searchParams.set('cell_selection', 'sea');

  let res: Response;
  try {
    res = await fetch(u.toString(), { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const json = (await res.json().catch(() => null)) as {
    hourly?: { time?: number[]; sea_level_height_msl?: (number | null)[] };
  } | null;
  const times = json?.hourly?.time;
  const heights = json?.hourly?.sea_level_height_msl;
  if (!Array.isArray(times) || !Array.isArray(heights) || times.length === 0) return null;

  const data: Array<{
    times: { valid_time: string };
    values: Array<{ name: string; value: number }>;
  }> = [];

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const h = heights[i];
    if (typeof t !== 'number' || h === null || typeof h !== 'number' || Number.isNaN(h)) continue;
    data.push({
      times: { valid_time: new Date(t * 1000).toISOString() },
      values: [{ name: 'tide_height', value: h }],
    });
  }

  if (data.length < 2) return null;

  return {
    data,
    _meta: {
      tideSource: 'open-meteo-marine',
      tideAttribution:
        'Open-Meteo marine — sea level vs global MSL (tide model). Not for navigation or piloting.',
    },
  };
}
