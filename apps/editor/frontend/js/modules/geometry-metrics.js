import { sharedCalculationCore } from '../../../../../shared/frontend/js/modules/temporal.js';

export const MEAN_EARTH_RADIUS_KM = 6371.0088;

export function distanceKm(a, b) {
  return lineDistanceKm([a, b]);
}

export function lineDistanceKm(coordinates = []) {
  return lineDistancesKm([coordinates])[0];
}

export function lineDistancesKm(lines) {
  if (typeof sharedCalculationCore.displayLineDistancesKm !== 'function') {
    throw Object.assign(new Error('Canonical C++ distance calculation is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  return sharedCalculationCore.displayLineDistancesKm(lines);
}

export function geometryAreaKm2(geometry) {
  return geometryAreasKm2([geometry])[0];
}

export function geometryAreasKm2(geometries) {
  if (typeof sharedCalculationCore.displayGeometryAreasKm2 !== 'function') {
    throw Object.assign(new Error('Canonical C++ area calculation is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  const polygons = geometries.map(geometry => geometry?.type === 'Polygon'
    ? [geometry.coordinates || []]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates || []
      : []);
  return sharedCalculationCore.displayGeometryAreasKm2(polygons);
}

export function formatArea(valueKm2, locale = 'ko-KR', { approximate = true } = {}) {
  const value = Math.max(0, Number(valueKm2 || 0));
  const digits = value < 1 ? 2 : value < 100 ? 1 : 0;
  return `${approximate ? '약 ' : ''}${value.toLocaleString(locale, { maximumFractionDigits: digits })} km²`;
}

export function percentChange(before, after) {
  const base = Number(before || 0);
  if (!(base > 0)) return null;
  return (Number(after || 0) - base) / base * 100;
}
