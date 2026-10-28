import { geometryAreaKm2 } from './geometry-metrics.js';
import { sharedCalculationCore } from '../../../../../shared/frontend/js/modules/temporal.js';
import { clippingOperationWithPrecisionRetry } from './polygon-clipping-calculation.js';

function polygonSets(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
}

function validGeometry(geometry) {
  if (typeof sharedCalculationCore.validateGisGeometry !== 'function') {
    throw Object.assign(new Error('Canonical C++ GIS geometry validator is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  return sharedCalculationCore.validateGisGeometry(polygonSets(geometry));
}

function ringBounds(ring) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const point of ring || []) {
    bounds[0] = Math.min(bounds[0], Number(point[0]));
    bounds[1] = Math.min(bounds[1], Number(point[1]));
    bounds[2] = Math.max(bounds[2], Number(point[0]));
    bounds[3] = Math.max(bounds[3], Number(point[1]));
  }
  return bounds;
}

function polygonBounds(geometry) {
  return polygonSets(geometry).map(polygon => ringBounds(polygon?.[0] || []));
}

const robustPolygonIntersection = (left, right) => (
  clippingOperationWithPrecisionRetry('intersection', left, right)
);

function planarArea(multiPolygon) {
  if (typeof sharedCalculationCore.gisValidationArea !== 'function') {
    throw Object.assign(new Error('Canonical C++ GIS overlap area is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  return sharedCalculationCore.gisValidationArea((multiPolygon || []).filter(polygon => polygon?.length));
}

function featureName(feature) {
  const properties = feature?.properties || {};
  return properties.pandolab_name || properties.NAME_KO || properties.NAME_0 || properties.NAME || properties.name || properties.pandolab_id || feature?.id || '국가';
}

function featureId(feature, index) {
  const properties = feature?.properties || {};
  return String(properties.pandolab_id || properties.ADM0_A3 || properties.ISO_A3 || properties.GID_0 || feature?.id || index + 1);
}

// overlapAffectedIds is a narrower, opt-in *pair* scope. Importers may pass
// only directly added/expanded roots when other modified roots are guaranteed
// subsets of their previously valid shapes (clipping by difference).
// All affected geometries still undergo complete structural validation.
export function validateCollection(collection, affectedIds = null, { overlapAffectedIds = null } = {}) {
  const features = collection?.features || [];
  const ids = features.map(featureId);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('국가 ID가 비어 있거나 중복되었습니다.');
  const affected = Array.isArray(affectedIds) && affectedIds.length ? new Set(affectedIds.map(String)) : null;
  const overlapAffected = affected && Array.isArray(overlapAffectedIds) && overlapAffectedIds.length
    ? new Set(overlapAffectedIds.map(String)) : affected;
  if (overlapAffected !== affected && [...overlapAffected].some(id => !affected.has(id)))
    throw new Error('Overlap pair scope must be part of the validated affected countries.');
  const componentBounds = [];
  for (let index = 0; index < features.length; index += 1) {
    if ((!affected || affected.has(ids[index])) && !validGeometry(features[index].geometry)) {
      throw new Error(`${featureName(features[index])}의 Polygon 경계가 유효하지 않습니다.`);
    }
    componentBounds.push(polygonBounds(features[index].geometry));
  }
  if (typeof sharedCalculationCore.GisOverlapCandidates !== 'function') {
    throw Object.assign(new Error('Canonical C++ GIS overlap scope is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  const candidates = new sharedCalculationCore.GisOverlapCandidates(componentBounds,
    ids.map(id => !!overlapAffected?.has(id)), !!overlapAffected);
  try {
    for (let candidate = candidates.next(); candidate; candidate = candidates.next()) {
      const i = candidate.leftIndex, j = candidate.rightIndex;
      const overlap = [];
      let overlapPlanarArea = 0;
      const leftPolygons = polygonSets(features[i].geometry);
      const rightPolygons = polygonSets(features[j].geometry);
      // Individual component intersections can fail on long shared borders
      // after a subtraction (e.g. Soviet/ROU). The same compiled polygon
      // kernel successfully handles these as one topological MultiPolygon.
      // Prefer a whole-geometry operation when the cartesian component count
      // is large; unlike a shortcut, this still verifies the *entire* pair.
      const fullPair = leftPolygons.length * rightPolygons.length > 64;
      if (fullPair) {
        try {
          const intersection = robustPolygonIntersection(leftPolygons, rightPolygons);
          if (intersection?.length) {
            overlap.push(...intersection);
            overlapPlanarArea += planarArea(intersection);
          }
        } catch (error) {
          throw new Error(`COUNTRY_OVERLAP_CALCULATION_FAILED: ${ids[i]}/${ids[j]} whole MultiPolygon: ${error.message}`, { cause: error });
        }
      } else {
        for (const [leftIndex, rightIndex] of candidate.componentPairs) {
          let componentOverlap;
          try {
            componentOverlap = robustPolygonIntersection(
              [leftPolygons[leftIndex]],
              [rightPolygons[rightIndex]],
            );
          } catch (error) {
            throw new Error(`COUNTRY_OVERLAP_CALCULATION_FAILED: ${ids[i]}/${ids[j]} polygon ${leftIndex}/${rightIndex}: ${error.message}`, { cause: error });
          }
          if (!componentOverlap?.length) continue;
          overlap.push(...componentOverlap);
          overlapPlanarArea += planarArea(componentOverlap);
        }
      }
      if (overlapPlanarArea <= 1e-8) continue;
      const overlapGeometry = { type: 'MultiPolygon', coordinates: overlap };
      const areaKm2 = geometryAreaKm2(overlapGeometry);
      return { overlapAreaKm2: areaKm2, firstOverlap: [ids[i], ids[j]] };
    }
  } finally {
    candidates.delete();
  }
  return { overlapAreaKm2: 0, firstOverlap: null };
}
