import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 3600; // cache 1 hour — meteoblue updates every 6h

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MeteoblueHour {
  time:          string;   // "2026-04-14 00:00"
  tempC:         number;
  feelsLikeC:    number;
  windKmh:       number;
  windDir:       number;   // degrees
  windGustKmh:   number;
  precipMm:      number;   // mm per hour
  precipProb:    number;   // 0–100
  cloudCover:    number;   // 0–100%
  humidityPct:   number;
  uvIndex:       number;
  snowFraction:  number;
  pictoCode:     number;   // meteoblue pictogram code (1=clear … 17=thunderstorm)
  isDaylight:    boolean;
}

interface MeteoblueMeta {
  lat:       number;
  lon:       number;
  asl:       number;
  timezone:  string;
  modelrun:  string;
}

export interface MeteoblueForecastResponse {
  meta:    MeteoblueMeta;
  hours:   MeteoblueHour[];
  source:  'meteoblue';
  fetchedAt: number;
}

// ── Helper ────────────────────────────────────────────────────────────────────

// meteoblue pictocode → plain-English sky description
export function pictoDescription(code: number): string {
  if (code <= 2)  return 'Clear sky';
  if (code <= 4)  return 'Partly cloudy';
  if (code <= 6)  return 'Cloudy';
  if (code === 7) return 'Overcast';
  if (code === 8) return 'Fog';
  if (code <= 11) return 'Light rain';
  if (code <= 13) return 'Rain showers';
  if (code === 14) return 'Heavy rain';
  if (code <= 16) return 'Thunderstorm';
  if (code === 17) return 'Severe thunderstorm';
  return 'Unknown';
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const apiKey = process.env.METEOBLUE_API_KEY;
  const lat    = process.env.METEOBLUE_LAT ?? '9.5120';
  const lon    = process.env.METEOBLUE_LON ?? '100.0137';
  const asl    = process.env.METEOBLUE_ASL ?? '5';

  if (!apiKey) {
    return NextResponse.json({ error: 'METEOBLUE_API_KEY not set' }, { status: 500 });
  }

  const url = `https://my.meteoblue.com/packages/basic-1h_clouds-1h_sunmoon?apikey=${apiKey}&lat=${lat}&lon=${lon}&asl=${asl}&format=json&tz=Asia%2FBangkok`;

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: `meteoblue ${res.status}: ${body}` }, { status: res.status });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await res.json();
    const d1h  = raw.data_1h;
    const dcld = raw.data_1h_clouds ?? {};   // clouds-1h package
    const dsun = raw.data_day?.sunrise ?? [];

    const hours: MeteoblueHour[] = (d1h.time as string[]).map((t: string, i: number) => ({
      time:         t,
      tempC:        d1h.temperature?.[i]         ?? 0,
      feelsLikeC:   d1h.felttemperature?.[i]     ?? d1h.temperature?.[i] ?? 0,
      windKmh:      d1h.windspeed?.[i]            ?? 0,
      windDir:      d1h.winddirection?.[i]        ?? 0,
      windGustKmh:  d1h.gust?.[i]                ?? 0,
      precipMm:     d1h.precipitation?.[i]        ?? 0,
      precipProb:   d1h.precipitation_probability?.[i] ?? 0,
      cloudCover:   dcld.totalcloudcover?.[i]    ?? d1h.lowclouds?.[i] ?? 0,
      humidityPct:  d1h.relativehumidity?.[i]    ?? 0,
      uvIndex:      d1h.uvindex?.[i]             ?? 0,
      snowFraction: d1h.snowfraction?.[i]        ?? 0,
      pictoCode:    d1h.pictocode?.[i]           ?? 0,
      isDaylight:   (dsun[i] ?? 1) === 1,
    }));

    const response: MeteoblueForecastResponse = {
      meta: {
        lat:      parseFloat(lat),
        lon:      parseFloat(lon),
        asl:      parseFloat(asl),
        timezone: raw.metadata?.timezone ?? 'Asia/Bangkok',
        modelrun: raw.metadata?.modelrun_updatetime_utc ?? '',
      },
      hours,
      source:    'meteoblue',
      fetchedAt: Math.floor(Date.now() / 1000),
    };

    return NextResponse.json(response);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('meteoblue/forecast:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
