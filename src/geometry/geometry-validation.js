import { coordinateBounds } from "./coordinate-bounds.js";
import { sharedCalculationCore } from "../document/temporal.js";

const featureId = (feature, fallback = '') => String(feature?.id || fallback);

function polygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  return geometry?.type === 'MultiPolygon' ? geometry.coordinates || [] : [];
}

function bounds(geometry) {
  const output = coordinateBounds(geometry?.coordinates);
  return output.every(Number.isFinite) ? output : null;
}

function issue(kind, message, details = {}) {
  const target = details.entityRefs?.join('|') || (details.vertexIndex ?? details.segmentIndex ?? 'map');
  return { id: `${kind}:${target}:${details.sequence || 0}`, kind, severity: details.severity || 'error', message, ...details };
}

const ringMessages = Object.freeze({
  'invalid-geometry': '고리를 구성하는 꼭짓점이 부족합니다.',
  'open-ring': 'Polygon 고리가 닫혀 있지 않습니다.',
  'zero-area': '면적이 없거나 지나치게 작은 고리입니다.',
  'duplicate-vertex': '연속된 중복 꼭짓점이 있습니다.',
  'self-intersection': '경계가 자기 자신과 교차합니다.',
});

function validateRing(ring, entityRefs, polygonIndex, ringIndex) {
  if (!Array.isArray(ring)) return [issue('invalid-geometry', ringMessages['invalid-geometry'], {
    entityRefs, coordinate: ring?.[0], polygonIndex, ringIndex,
  })];
  if (typeof sharedCalculationCore.validateTerritorialRing !== 'function') {
    throw Object.assign(new Error('Canonical C++ ring validator is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  return sharedCalculationCore.validateTerritorialRing(ring).map(result => issue(result.kind,
    result.kind === 'invalid-geometry' && result.vertexIndex != null ? '유효하지 않은 좌표가 있습니다.' : ringMessages[result.kind], {
    entityRefs, coordinate: result.coordinate, polygonIndex, ringIndex,
    ...(result.vertexIndex == null ? {} : { vertexIndex: result.vertexIndex }),
    ...(result.segmentIndex == null ? {} : { segmentIndex: result.segmentIndex }),
  }));
}

export function validateGeometry(feature) {
  const id = featureId(feature, 'unknown');
  const geometry = feature?.geometry;
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    return [issue('invalid-geometry', 'Polygon 또는 MultiPolygon geometry가 필요합니다.', { entityRefs: [id], bounds: bounds(geometry) })];
  }
  const issues = [];
  polygons(geometry).forEach((polygon, polygonIndex) => {
    if (!polygon?.length) issues.push(issue('invalid-geometry', '빈 Polygon component가 있습니다.', { entityRefs: [id], polygonIndex }));
    (polygon || []).forEach((ring, ringIndex) => issues.push(...validateRing(ring, [id], polygonIndex, ringIndex)));
  });
  return issues;
}
