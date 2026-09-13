'use client';

import { useEffect, type RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  KN_PER_MS,
  WIND_RASTER_OPACITY,
  rasterizeWindField,
  sampleUv,
  type WindOverlayField,
} from '@/lib/wind-overlay';

const SOURCE_ID = 'samui-wind-overlay';
const LAYER_ID = 'samui-wind-overlay-layer';
const RADAR_LAYER_ID = 'rainviewer-radar-layer';
const PARTICLE_COUNT = 2200;
const MAX_AGE = 140;
const FADE = 0.08;
const LINE_W = 1.8;
const TARGET_PX = 2.1;
const REF_MS = 1.2;
const MAX_WIND_MS = 80;
const M_PER_DEG = 111320;
const MIN_SEG_PX = 1.6;

type Particle = { lon: number; lat: number; age: number };
type RasterUrl = {
  url: string;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
};

function seed(field: WindOverlayField): Particle {
  return {
    lon: field.west + Math.random() * (field.east - field.west),
    lat: field.south + Math.random() * (field.north - field.south),
    age: Math.floor(Math.random() * 80),
  };
}

function fieldToImage(field: WindOverlayField): RasterUrl | null {
  const rast = rasterizeWindField(field);
  if (!rast) return null;
  const canvas = document.createElement('canvas');
  canvas.width = rast.width;
  canvas.height = rast.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(rast.width, rast.height);
  img.data.set(rast.data);
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), coordinates: rast.coordinates };
}

function waitForMap(mapRef: RefObject<MapRef | null>, signal: { cancelled: boolean }): Promise<MapLibreMap | null> {
  return new Promise((resolve) => {
    const tick = () => {
      if (signal.cancelled) {
        resolve(null);
        return;
      }
      const map = mapRef.current?.getMap();
      if (map && map.isStyleLoaded()) {
        resolve(map);
        return;
      }
      window.setTimeout(tick, 80);
    };
    tick();
  });
}

function applyRaster(map: MapLibreMap, image: RasterUrl) {
  const existing = map.getSource(SOURCE_ID) as { updateImage?: (opts: RasterUrl) => void } | undefined;
  if (existing?.updateImage) {
    existing.updateImage({ url: image.url, coordinates: image.coordinates });
  } else if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'image',
      url: image.url,
      coordinates: image.coordinates,
    });
  }
  if (!map.getLayer(LAYER_ID)) {
    const spec = {
      id: LAYER_ID,
      type: 'raster' as const,
      source: SOURCE_ID,
      paint: {
        'raster-opacity': WIND_RASTER_OPACITY,
        'raster-fade-duration': 0,
        'raster-resampling': 'linear' as const,
      },
    };
    if (map.getLayer(RADAR_LAYER_ID)) map.addLayer(spec, RADAR_LAYER_ID);
    else map.addLayer(spec);
  } else {
    map.setLayoutProperty(LAYER_ID, 'visibility', 'visible');
    map.setPaintProperty(LAYER_ID, 'raster-opacity', WIND_RASTER_OPACITY);
  }
  if (map.getLayer(LAYER_ID) && map.getLayer(RADAR_LAYER_ID)) {
    try {
      map.moveLayer(LAYER_ID, RADAR_LAYER_ID);
    } catch {
      /* radar not ready */
    }
  }
}

function removeRaster(map: MapLibreMap) {
  try {
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
  } catch {
    /* already gone */
  }
  try {
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  } catch {
    /* already gone */
  }
}

export default function WindyWindOverlay({
  mapRef,
  enabled,
}: {
  mapRef: RefObject<MapRef | null>;
  enabled: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    const signal = { cancelled: false };
    let frame = 0;
    let canvas: HTMLCanvasElement | null = null;
    let map: MapLibreMap | null = null;
    let onResize: (() => void) | null = null;

    (async () => {
      const ready = await waitForMap(mapRef, signal);
      if (!ready || signal.cancelled) return;
      map = ready;

      const res = await fetch('/api/weather/wind-overlay', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const field = (await res.json()) as WindOverlayField;
      if (signal.cancelled) return;
      const image = fieldToImage(field);
      if (!image) return;
      applyRaster(map, image);

      const host = map.getCanvasContainer();
      const gl = map.getCanvas();
      canvas = document.createElement('canvas');
      canvas.dataset.windParticles = '1';
      canvas.style.cssText = 'position:absolute;inset:0;z-index:4;pointer-events:none';
      if (gl?.parentNode === host) gl.insertAdjacentElement('afterend', canvas);
      else host.appendChild(canvas);
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return;

      const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => seed(field));
      const size = () => {
        if (!canvas) return;
        const w = Math.max(1, Math.round(gl.clientWidth || host.clientWidth));
        const h = Math.max(1, Math.round(gl.clientHeight || host.clientHeight));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          canvas.style.width = `${w}px`;
          canvas.style.height = `${h}px`;
        }
      };
      size();
      onResize = size;
      map.on('resize', onResize);

      const tick = () => {
        if (signal.cancelled || !canvas) return;
        size();
        const w = canvas.width;
        const h = canvas.height;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(255,255,255,${FADE})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        ctx.lineCap = 'round';
        ctx.lineWidth = LINE_W;
        const zoom = map!.getZoom();
        const center = map!.getCenter();
        const mpp =
          (156543.03392 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180))) / 2 ** zoom;
        const dt = (TARGET_PX * mpp) / REF_MS;
        const buckets: number[][] = [[], [], []];
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i]!;
          p.age += 1;
          if (p.age > MAX_AGE) {
            particles[i] = seed(field);
            continue;
          }
          const sampled = sampleUv(field, p.lon, p.lat);
          if (!sampled) {
            particles[i] = seed(field);
            continue;
          }
          let u = sampled.u;
          let v = sampled.v;
          const spd = Math.hypot(u, v);
          if (spd > MAX_WIND_MS && spd > 0) {
            const k = MAX_WIND_MS / spd;
            u *= k;
            v *= k;
          }
          const startLon = p.lon;
          const startLat = p.lat;
          const cosLat = Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
          p.lon += (u * dt) / (M_PER_DEG * cosLat);
          p.lat += (v * dt) / M_PER_DEG;
          const a = map!.project([startLon, startLat]);
          const b = map!.project([p.lon, p.lat]);
          let x0 = a.x;
          let y0 = a.y;
          let x1 = b.x;
          let y1 = b.y;
          const seg = Math.hypot(x1 - x0, y1 - y0);
          if (seg > 0 && seg < MIN_SEG_PX) {
            const s = MIN_SEG_PX / seg;
            x1 = x0 + (x1 - x0) * s;
            y1 = y0 + (y1 - y0) * s;
          }
          const kn = spd * KN_PER_MS;
          buckets[kn < 6 ? 0 : kn < 16 ? 1 : 2]!.push(x0, y0, x1, y1);
        }
        const colors = [
          'rgba(255,255,255,0.72)',
          'rgba(255,255,255,0.86)',
          'rgba(255,255,255,0.96)',
        ];
        for (let bi = 0; bi < 3; bi++) {
          const segs = buckets[bi]!;
          if (!segs.length) continue;
          ctx.strokeStyle = colors[bi]!;
          ctx.beginPath();
          for (let i = 0; i < segs.length; i += 4) {
            ctx.moveTo(segs[i]!, segs[i + 1]!);
            ctx.lineTo(segs[i + 2]!, segs[i + 3]!);
          }
          ctx.stroke();
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    })().catch(() => {
      /* overlay stays off if ICON picture fails */
    });

    return () => {
      signal.cancelled = true;
      cancelAnimationFrame(frame);
      if (map && onResize) map.off('resize', onResize);
      canvas?.remove();
      if (map) removeRaster(map);
    };
  }, [enabled, mapRef]);

  return null;
}
