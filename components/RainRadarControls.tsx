'use client';

import React, { useEffect, useState, useRef } from 'react';
import type { SamuiWeatherForecastRow } from '../lib/spire';

export interface RadarFrame {
  time: number;
  path: string;
}

interface RainRadarControlsProps {
  forecastRows: SamuiWeatherForecastRow[];
  onTimeChange: (activeUrl: string | null, spireIndex: number) => void;
  requestedSpireIndex?: number | null;
  onJumpComplete?: () => void;
}

export default function RainRadarControls({ forecastRows, onTimeChange, requestedSpireIndex, onJumpComplete }: RainRadarControlsProps) {
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [host, setHost] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(false);
  
  const spireRows = forecastRows.slice(0, 25);
  const totalFrames = frames.length > 0 ? frames.length + spireRows.length - 1 : 0;

  const indexRef = useRef(0);
  const totalFramesRef = useRef(0);
  
  useEffect(() => {
    indexRef.current = currentIndex;
    totalFramesRef.current = totalFrames;
  }, [currentIndex, totalFrames]);

  // Fetch (and auto-refresh every 5 min) RainViewer frames
  useEffect(() => {
    let controller = new AbortController();

    const loadFrames = () => {
      controller = new AbortController();
      fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: controller.signal })
        .then(res => {
          if (!res.ok) throw new Error('RainViewer API error');
          return res.json();
        })
        .then(data => {
          const past: RadarFrame[]    = data.radar?.past    ?? [];
          const nowcast: RadarFrame[] = data.radar?.nowcast ?? [];
          const allFrames = [...past, ...nowcast];

          if (allFrames.length > 0) {
            setHost(data.host ?? 'https://tilecache.rainviewer.com');
            setFrames(prev => {
              // Only jump to latest frame on first load, not on refresh
              if (prev.length === 0) setCurrentIndex(Math.max(0, past.length - 1));
              return allFrames;
            });
            setError(false);
          } else {
            setError(true);
          }
        })
        .catch(err => {
          if ((err as Error).name !== 'AbortError') setError(true);
        });
    };

    loadFrames();
    const interval = setInterval(loadFrames, 5 * 60 * 1000); // refresh every 5 min

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  // Update parent — only pass the single active frame URL
  useEffect(() => {
    if (frames.length === 0 || !host) {
      onTimeChange(null, 0);
      return;
    }

    if (currentIndex < frames.length) {
      // Radar frame: build proxy URL for only the active frame
      const frame = frames[currentIndex];
      const tilePath = frame.path.replace(/^\//, '');
      // 512 px + /2/1_1 — RainViewer public API default; max native zoom 7
      const activeUrl = `/api/radar/${tilePath}/512/{z}/{x}/{y}/2/1_1.png`;
      onTimeChange(activeUrl, 0);
    } else {
      // Future (Spire) frame: hide radar overlay
      const spireIndex = currentIndex - frames.length + 1;
      onTimeChange(null, spireIndex);
    }
  }, [currentIndex, frames, host, onTimeChange]);

  // Player loop
  useEffect(() => {
    if (!isPlaying || totalFrames === 0) return;
    
    let timer: NodeJS.Timeout;
    
    const playNext = () => {
      const nextIndex = indexRef.current + 1;

      if (nextIndex >= totalFramesRef.current) {
        // Reached end — stop playback
        setIsPlaying(false);
      } else {
        setCurrentIndex(nextIndex);
        timer = setTimeout(playNext, 800);
      }
    };
    
    timer = setTimeout(playNext, 800);
    
    return () => clearTimeout(timer);
  }, [isPlaying, totalFrames]);

  const jumpToSpire = (hours: number) => {
    if (frames.length === 0) return;
    const targetSpireIndex = Math.min(hours, spireRows.length - 1);
    setIsPlaying(false);
    setCurrentIndex(frames.length - 1 + targetSpireIndex);
  };

  useEffect(() => {
    if (requestedSpireIndex !== undefined && requestedSpireIndex !== null) {
      jumpToSpire(requestedSpireIndex);
      onJumpComplete?.();
    }
  }, [requestedSpireIndex]);

  if (error) return null;
  if (frames.length === 0) return null; // loading

  const isFuture = currentIndex >= frames.length;
  const currentSpireIndex = isFuture ? currentIndex - frames.length + 1 : 0;
  
  let timeStr = '--:--';
  if (!isFuture) {
    const currentFrame = frames[currentIndex];
    if (currentFrame) {
      timeStr = new Date(currentFrame.time * 1000).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Bangkok',
      });
    }
  } else {
    const row = spireRows[currentSpireIndex];
    if (row) {
      timeStr = new Date(row.time).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Bangkok',
      });
    }
  }

  const sliderColor = isFuture ? 'accent-amber-400 bg-white/20' : 'accent-cyan-400 bg-white/20';
  const badgeText = isFuture ? 'SPIRE SATELLITE PREDICTION' : 'SURAT THANI RADAR · TMD';
  const badgeColor = isFuture ? 'text-amber-400' : 'text-cyan-400';

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 w-[90%] max-w-md flex flex-col gap-2 sm:top-auto sm:bottom-10 sm:left-auto sm:right-10 sm:translate-x-0">

      <div className="rounded-full border border-white/20 bg-slate-900/60 p-2 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl flex items-center gap-3">
        
        {/* Play/Pause Button */}
        <button 
          onClick={() => setIsPlaying(!isPlaying)}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-lg transition-colors ${isFuture ? 'bg-amber-500 hover:bg-amber-400' : 'bg-cyan-500 hover:bg-cyan-400'}`}
          aria-label={isPlaying ? "Pause timeline" : "Play timeline"}
        >
          {isPlaying ? (
             <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
               <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
             </svg>
          ) : (
             <svg className="h-5 w-5 fill-current ml-1" viewBox="0 0 24 24">
               <path d="M8 5v14l11-7z" />
             </svg>
          )}
        </button>

        {/* Slider */}
        <div className="flex-1 flex flex-col justify-center px-2">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-[10px] font-black uppercase tracking-widest ${badgeColor}`}>
              {badgeText}
            </span>
            <span className="text-xs font-mono font-bold text-white bg-black/30 px-2 py-0.5 rounded-md">
              {timeStr}
            </span>
          </div>
          
          <input 
            type="range"
            min={0}
            max={totalFrames - 1}
            step={1}
            value={currentIndex}
            onChange={(e) => {
              setIsPlaying(false);
              setCurrentIndex(Number(e.target.value));
            }}
            className={`w-full h-1.5 cursor-pointer appearance-none rounded-full ${sliderColor}`}
          />
        </div>
      </div>
    </div>
  );
}
