import type { StyleSpecification } from 'maplibre-gl';

/**
 * OpenStreetMap raster + warm ocean background + tropical lift.
 * Use when `NEXT_PUBLIC_MAPTILER_API_KEY` is unset or for debugging tile issues.
 * OSM usage policy: https://operations.osmfoundation.org/policies/tiles/
 */
export const SAMUI_TROPICAL_MAPLIBRE_STYLE: StyleSpecification = {
  version: 8,
  name: 'Samui Tropical (OSM)',
  projection: { type: 'mercator' },

  sources: {
    basemap: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },

  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#0b2a38',
      },
    },
    {
      id: 'satellite',
      type: 'raster',
      source: 'basemap',
      minzoom: 0,
      maxzoom: 22,
      paint: {
        'raster-opacity': 0.85,
        'raster-brightness-min': 0.25,
        'raster-brightness-max': 1,
        'raster-saturation': 0.35,
        'raster-contrast': -0.08,
        'raster-hue-rotate': -10,
        'raster-fade-duration': 500,
      },
    },
  ],
};

function createMapTilerSatelliteStyle(apiKey: string): StyleSpecification {
  const key = encodeURIComponent(apiKey.trim());
  return {
    ...SAMUI_TROPICAL_MAPLIBRE_STYLE,
    name: 'Samui Tropical Paradise',
    sources: {
      basemap: {
        type: 'raster',
        tiles: [`https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${key}`],
        tileSize: 256,
        attribution: '© MapTiler © OpenStreetMap contributors',
      },
    },
  };
}

/**
 * MapTiler satellite when `apiKey` is non-empty; otherwise OSM (always shows land/ocean).
 * Use with MapLibre only (`react-map-gl/maplibre`).
 */
export function createSamuiTropicalMaplibreStyle(apiKey: string): StyleSpecification {
  const key = apiKey?.trim();
  if (!key) return SAMUI_TROPICAL_MAPLIBRE_STYLE;
  return createMapTilerSatelliteStyle(key);
}
