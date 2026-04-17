import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Prefer English place names on vector basemaps (MapTiler / OpenMapTiles), then Latin script,
 * Thai (`name:th`), then local default `name`. No-op for raster-only styles.
 */
export function applyPreferredPlaceLabels(map: MapLibreMap): void {
  const layers = map.getStyle().layers ?? [];
  for (const layer of layers) {
    if (layer.type !== 'symbol') continue;
    const layout = layer.layout as Record<string, unknown> | undefined;
    if (!layout?.['text-field']) continue;
    try {
      map.setLayoutProperty(layer.id, 'text-field', [
        'coalesce',
        ['get', 'name:en'],
        ['get', 'name:latin'],
        ['get', 'name:th'],
        ['get', 'name'],
      ]);
    } catch {
      /* layer may not support this expression */
    }
  }
}
