/** Shared types + helpers for Meteoblue API (used by `/api/meteoblue/forecast`). */

export interface MeteoblueHour {
  time: string;
  tempC: number;
  feelsLikeC: number;
  windKmh: number;
  windDir: number;
  windGustKmh: number;
  precipMm: number;
  precipProb: number;
  cloudCover: number;
  humidityPct: number;
  uvIndex: number;
  snowFraction: number;
  pictoCode: number;
  isDaylight: boolean;
}

interface MeteoblueMeta {
  lat: number;
  lon: number;
  asl: number;
  timezone: string;
  modelrun: string;
}

export interface MeteoblueForecastResponse {
  meta: MeteoblueMeta;
  hours: MeteoblueHour[];
  source: 'meteoblue';
  fetchedAt: number;
}

/** meteoblue pictocode → plain-English sky description */
export function pictoDescription(code: number): string {
  if (code <= 2) return 'Clear sky';
  if (code <= 4) return 'Partly cloudy';
  if (code <= 6) return 'Cloudy';
  if (code === 7) return 'Overcast';
  if (code === 8) return 'Fog';
  if (code <= 11) return 'Light rain';
  if (code <= 13) return 'Rain showers';
  if (code === 14) return 'Heavy rain';
  if (code <= 16) return 'Thunderstorm';
  if (code === 17) return 'Severe thunderstorm';
  return 'Unknown';
}
