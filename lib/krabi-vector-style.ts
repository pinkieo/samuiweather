import type { StyleSpecification } from 'maplibre-gl';

const MAPTILER_KEY = (process.env.NEXT_PUBLIC_MAPTILER_KEY || process.env.NEXT_PUBLIC_MAPTILER_API_KEY || '').trim();

/**
 * Pure OSM raster — slightly **darker** muted grey, no vector layer (labels stay server Thai in tiles).
 * Without a MapTiler key: this only. With `NEXT_PUBLIC_MAPTILER_*`: use `fetchExploreBasemapStyle` (English + Thai fallback).
 */
export const KRABI_TROPICAL_OS_FALLBACK: StyleSpecification = {
  version: 8,
  name: 'Krabi OSM Raster',
  projection: { type: 'mercator' },
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#d4d2ce' } },
    {
      id: 'osm-raster',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 22,
      paint: {
        'raster-opacity': 0.96,
        'raster-brightness-min': 0.52,
        'raster-brightness-max': 1,
        'raster-saturation': -0.48,
        'raster-contrast': 0.12,
        'raster-hue-rotate': 0,
      },
    },
  ],
};

/**
 * MapTiler Streets v2 + `language=en` — same basemap for **Krabi and Samui** tabs in MapViewer.
 * `applyPreferredPlaceLabels` adds Thai/local labels where English is missing.
 */
export async function fetchExploreBasemapStyle(): Promise<StyleSpecification> {
  if (!MAPTILER_KEY) return KRABI_TROPICAL_OS_FALLBACK;

  try {
    const res = await fetch(
      `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(MAPTILER_KEY)}&language=en`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const style: StyleSpecification = await res.json();
    if (!style.layers) style.layers = [];

    style.layers.forEach(layer => {
      if (layer.type === 'background') {
        layer.paint = { 'background-color': '#d4d2ce' };
      }
    });

    style.name = 'Explore EN';
    return style;
  } catch {
    return KRABI_TROPICAL_OS_FALLBACK;
  }
}

export async function fetchKrabiTropicalVectorStyle(): Promise<StyleSpecification> {
  if (!MAPTILER_KEY) return KRABI_TROPICAL_OS_FALLBACK;

  try {
    const res = await fetch(
      `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(MAPTILER_KEY)}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const style: StyleSpecification = await res.json();

    if (!style.layers) {
      style.layers = [];
    }

    style.sources = {
      ...style.sources,
      krabi_satellite: {
        type: 'raster',
        tiles: [`https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${encodeURIComponent(MAPTILER_KEY)}`],
        tileSize: 256,
        attribution: '© MapTiler © OpenStreetMap contributors',
      },
    };

    const bgIndex = style.layers.findIndex((l: { type?: string }) => l.type === 'background');
    const insertIndex = bgIndex >= 0 ? bgIndex + 1 : 1;

    style.layers.splice(insertIndex, 0, {
      id: 'krabi-satellite-underlay',
      type: 'raster',
      source: 'krabi_satellite',
      minzoom: 0,
      maxzoom: 22,
      paint: {
        'raster-opacity': 0.65,
        'raster-brightness-min': 0.45,
        'raster-brightness-max': 1.0,
        'raster-saturation': 0.3,
        'raster-contrast': -0.1,
        'raster-hue-rotate': -12,
      },
    });

    style.layers.forEach(layer => {
      if (layer.type === 'background') {
        layer.paint = { 'background-color': '#0f2c3f' };
      }
    });

    style.name = 'Krabi Tropical Vector';
    return style;
  } catch {
    return KRABI_TROPICAL_OS_FALLBACK;
  }
}
