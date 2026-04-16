/**
 * Raster-only basemap: `mapbox://mapbox.satellite` with no vector layers.
 * Hosted styles like `satellite-v9` / `satellite-streets-v12` can still bundle
 * vector road layers whose expressions use ["get","len"] — null at low zoom → console errors.
 * This style has zero vector sources, so those expressions never run.
 */
import type { StyleSpecification } from 'mapbox-gl';

/**
 * Solid background only — no sources, no tiles, no vector layers.
 * Use the “Mapbox only” debug tab to confirm console is clean; if `len` errors
 * still appear, they are not coming from map style expressions.
 */
export const MINIMAL_BACKGROUND_ONLY_STYLE: StyleSpecification = {
  version: 8,
  name: 'Debug background only',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#0a1628',
      },
    },
  ],
};

export const SAMUI_SATELLITE_ONLY_STYLE: StyleSpecification = {
  version: 8,
  name: 'Samui satellite (raster only)',
  metadata: {
    'mapbox:autocomposite': false,
  },
  /** Globe is default in many Mapbox stacks; without this, adding runtime layers (radar) can flash “zoom not supported”. */
  projection: { name: 'mercator' },
  sources: {
    /** Basemap only — RainViewer is a separate runtime `Source` in SamuiExploreMap (512 / maxzoom 7). */
    satellite: {
      type: 'raster',
      url: 'mapbox://mapbox.satellite',
      /** TileJSON for mapbox.satellite uses 256; keep independent from RainViewer 512px tiles. */
      tileSize: 256,
    },
  },
  layers: [
    {
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};
