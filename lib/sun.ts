import SunCalc from 'suncalc';
import { SAMUI_CENTER } from './spire';

export interface SunInfo {
  sunrise: Date;
  sunset: Date;
  goldenHour: Date;
  isDay: boolean;
  sunPosition: number; // 0 to 1 progress during day, <0 or >1 during night
}

export function getSunInfo(date: Date = new Date()): SunInfo {
  const times = SunCalc.getTimes(date, SAMUI_CENTER.lat, SAMUI_CENTER.lon);
  
  const now = date.getTime();
  const rise = times.sunrise.getTime();
  const set = times.sunset.getTime();
  
  const isDay = now >= rise && now <= set;
  let sunPosition = -1;
  
  if (isDay) {
    sunPosition = (now - rise) / (set - rise);
  } else if (now < rise) {
    // Before sunrise
    sunPosition = -0.1; 
  } else {
    // After sunset
    sunPosition = 1.1;
  }
  
  return {
    sunrise: times.sunrise,
    sunset: times.sunset,
    goldenHour: times.goldenHour,
    isDay,
    sunPosition,
  };
}