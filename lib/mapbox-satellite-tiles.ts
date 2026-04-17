import type { RequestTransformFunction } from 'mapbox-gl';
import type { RequestParameters, ResourceType } from 'maplibre-gl';

function isSameOriginUrl(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Tile / image requests: same-origin → `credentials: 'same-origin'`.
 * Mapbox raster API (`/v4/…`) → Accept + referrerPolicy; optional PNG for `mapbox.satellite` WebP.
 */
export const exploreMapTransformRequest: RequestTransformFunction = (
  url,
  resourceType,
) => {
  if (isSameOriginUrl(url)) {
    return {
      url,
      credentials: 'same-origin',
    };
  }

  if (resourceType != null && resourceType !== 'Tile') {
    return { url };
  }

  if (url.includes('api.mapbox.com') && url.includes('/v4/')) {
    let u = url;
    if (u.includes('mapbox.satellite')) {
      if (u.includes('@2x.webp')) u = u.replace('@2x.webp', '@2x.png');
      else if (u.includes('.webp')) u = u.replace('.webp', '.png');
    }
    return {
      url: u,
      headers: {
        Accept: 'image/webp,image/png,image/apng,image/*,*/*;q=0.8',
      },
      referrerPolicy: 'strict-origin-when-cross-origin',
    };
  }

  return { url };
};

/**
 * Same rules as {@link exploreMapTransformRequest} for MapLibre (`react-map-gl/maplibre`).
 */
export function maplibreExploreTransformRequest(
  url: string,
  resourceType?: ResourceType,
): RequestParameters {
  if (isSameOriginUrl(url)) {
    return {
      url,
      credentials: 'same-origin',
    };
  }

  if (resourceType != null && resourceType !== 'Tile') {
    return { url };
  }

  if (url.includes('api.mapbox.com') && url.includes('/v4/')) {
    let u = url;
    if (u.includes('mapbox.satellite')) {
      if (u.includes('@2x.webp')) u = u.replace('@2x.webp', '@2x.png');
      else if (u.includes('.webp')) u = u.replace('.webp', '.png');
    }
    return {
      url: u,
      headers: {
        Accept: 'image/webp,image/png,image/apng,image/*,*/*;q=0.8',
      },
      referrerPolicy: 'strict-origin-when-cross-origin',
    };
  }

  return { url };
}

/** @deprecated use exploreMapTransformRequest */
export const mapboxSatelliteRasterRequest = exploreMapTransformRequest;
