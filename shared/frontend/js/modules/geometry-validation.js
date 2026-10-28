import { territorialRootId } from './territorial-units.js';
import { coordinateBounds } from './coordinate-bounds.js';
import { sharedCalculationCore } from './temporal.js';

const clone = value => value == null ? value : structuredClone(value);
const featureId = (feature, fallback = '') => String(feature?.id || fallback);

function polygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  return geometry?.type === 'MultiPolygon' ? geometry.coordinates || [] : [];
}

function multiCoordinates(geometry) {
  return polygons(geometry);
}

function sampleRing(ring = [], maximumVertices = 16) {
  const count = Math.max(0, ring.length - 1);
  if (count <= maximumVertices) return clone(ring);
  const sampled = [];
  for (let index = 0; index < maximumVertices; index += 1) sampled.push(clone(ring[Math.floor(index * count / maximumVertices)]));
  if (sampled.length) sampled.push(clone(sampled[0]));
  return sampled;
}

function verificationMultiCoordinates(geometry) {
  return polygons(geometry).map(polygon => (polygon || []).map(ring => sampleRing(ring, 512)));
}

function bounds(geometry) {
  const output = coordinateBounds(geometry?.coordinates);
  return output.every(Number.isFinite) ? output : null;
}

function geometryPlanarArea(geometry) {
  const components = polygons(geometry).filter(polygon => polygon?.length);
  if (typeof sharedCalculationCore.territorialValidationArea !== 'function') {
    throw Object.assign(new Error('Canonical C++ validation area is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  return sharedCalculationCore.territorialValidationArea(components);
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

function clipGeometry(type, coordinates) {
  return { type, coordinates: clone(coordinates) };
}

export function validateTerritorialGeometry(features = [], {
  clipper = null, baselineUnion = null, affectedIds = null, pairKeys = null, diagnostics = null, overlapOnly = false,
} = {}) {
  const issues = [];
  const seen = new Map();
  const affected = affectedIds ? new Set([...affectedIds].map(String)) : null;
  const candidates = affected ? features.filter(feature => affected.has(featureId(feature))) : features;
  if (!overlapOnly) {
    features.forEach((feature, index) => {
      const id = featureId(feature, index);
      if (seen.has(id)) issues.push(issue('duplicate-id', `중복 ID ${id}가 있습니다.`, { entityRefs: [seen.get(id), id], bounds: bounds(feature.geometry) }));
      else seen.set(id, id);
    });
    for (const feature of candidates) issues.push(...validateGeometry(feature));
  }
  if (!clipper?.intersection || !candidates.length) return issues;

  const verificationCoordinates = new WeakMap();
  const componentBoundsCache = new WeakMap();
  const polygonPointIndexCache = new WeakMap();
  const polygonIndexes = [];
  const verificationFor = feature => {
    if (!verificationCoordinates.has(feature)) verificationCoordinates.set(feature, verificationMultiCoordinates(feature.geometry));
    return verificationCoordinates.get(feature);
  };
  const componentBoundsFor = feature => {
    if (!componentBoundsCache.has(feature)) {
      componentBoundsCache.set(feature, polygons(feature.geometry).map(coordinates => bounds({ coordinates })));
    }
    return componentBoundsCache.get(feature);
  };
  const polygonPointIndexesFor = feature => {
    if (!polygonPointIndexCache.has(feature)) {
      if (typeof sharedCalculationCore.TerritorialPolygonIndex !== 'function') {
        throw Object.assign(new Error('Canonical C++ territorial polygon index is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
      }
      const indexes = polygons(feature.geometry).map(polygon => {
        const index = new sharedCalculationCore.TerritorialPolygonIndex(polygon);
        polygonIndexes.push(index);
        return index;
      });
      polygonPointIndexCache.set(feature, indexes);
    }
    return polygonPointIndexCache.get(feature);
  };
  if (typeof sharedCalculationCore.TerritorialOverlapCandidates !== 'function') {
    throw Object.assign(new Error('Canonical C++ territorial overlap scope is unavailable.'), { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  const ids = features.map(feature => featureId(feature));
  const featureBounds = features.map(feature => bounds(feature.geometry));
  const iterator = new sharedCalculationCore.TerritorialOverlapCandidates(ids, featureBounds,
    ids.map(id => !!affected?.has(id)), !!affected, pairKeys ? [...pairKeys].filter(key => typeof key === 'string') : null);
  try {
    for (let candidate = iterator.next(); candidate; candidate = iterator.next()) {
      const feature = features[candidate.leftIndex], other = features[candidate.rightIndex];
      const id = ids[candidate.leftIndex], otherId = ids[candidate.rightIndex];
      const candidateBounds = featureBounds[candidate.leftIndex];
      const componentPairs = iterator.components(componentBoundsFor(feature), componentBoundsFor(other));
      if (!componentPairs.length) continue;
      // Most country pairs whose bounds touch only share a border. A small,
      // noncanonical preflight rejects those cheaply; canonical coordinates are
      // still used for every pair that could contain an overlap.
      let coarseMayOverlap = !!affected;
      if (pairKeys && !affected) {
        for (const [leftIndex, rightIndex] of componentPairs) {
          let verification;
          try {
            verification = clipper.intersection(
              [verificationFor(feature)[leftIndex]], [verificationFor(other)[rightIndex]],
            );
          } catch (_) {
            coarseMayOverlap = true;
            break;
          }
          if (geometryPlanarArea(clipGeometry('MultiPolygon', verification)) > 1e-8) {
            coarseMayOverlap = true;
            break;
          }
        }
      } else {
        for (const [leftIndex, rightIndex] of componentPairs) {
          if (coarseMayOverlap || polygonPointIndexesFor(feature)[leftIndex].mayOverlap(
            polygonPointIndexesFor(other)[rightIndex], componentBoundsFor(feature)[leftIndex], componentBoundsFor(other)[rightIndex],
          )) {
            coarseMayOverlap = true;
            break;
          }
        }
      }
      if (!coarseMayOverlap) continue;
      if (diagnostics) diagnostics.preciseIntersectionPairs = (diagnostics.preciseIntersectionPairs || 0) + 1;
      const coordinates = [];
      let intersectionFailed = false;
      try {
        const leftPolygons = multiCoordinates(feature.geometry);
        const rightPolygons = multiCoordinates(other.geometry);
        for (const [leftIndex, rightIndex] of componentPairs) {
          const result = clipper.intersection([leftPolygons[leftIndex]], [rightPolygons[rightIndex]]);
          if (result?.length) coordinates.push(...result);
        }
      } catch (_) {
        intersectionFailed = true;
        issues.push(issue('invalid-geometry', `${id}와 ${otherId}의 중첩 검사를 완료하지 못했습니다.`, {
          entityRefs: [id, otherId], bounds: candidateBounds,
        }));
      }
      if (intersectionFailed) continue;
      const overlap = clipGeometry('MultiPolygon', coordinates);
      const overlapPlanarArea = geometryPlanarArea(overlap);
      if (overlapPlanarArea <= 1e-10) continue;
      issues.push(issue('overlap', `${id}와 ${otherId} 사이에 중첩 영역이 있습니다.`, {
        entityRefs: [id, otherId], geometry: overlap, bounds: bounds(overlap), planarArea: overlapPlanarArea,
      }));
    }
  } finally {
    try {
      if (diagnostics) {
        const counts = iterator.diagnostics();
        if (counts.boundsCandidatePairs) diagnostics.boundsCandidatePairs = (diagnostics.boundsCandidatePairs || 0) + counts.boundsCandidatePairs;
        if (counts.componentEvaluated) diagnostics.componentCandidatePairs = (diagnostics.componentCandidatePairs || 0) + counts.componentCandidatePairs;
      }
    } finally {
      try { for (const index of polygonIndexes) index.delete(); }
      finally { iterator.delete(); }
    }
  }
  if (baselineUnion && clipper.xor && candidates.length) {
    const currentUnion = clipper.union(...candidates.map(feature => multiCoordinates(feature.geometry)));
    const changed = clipGeometry('MultiPolygon', clipper.xor(multiCoordinates(baselineUnion), currentUnion));
    if (geometryPlanarArea(changed) > 1e-10) issues.push(issue('gap', '편집 전 영역과 비교해 빈틈 또는 면적 손실이 생겼습니다.', {
      entityRefs: candidates.map(featureId), geometry: changed, bounds: bounds(changed),
    }));
  }
  return issues;
}

function validateAdministrativeContainment(units = [], countries = [], { clipper = null } = {}) {
  const issues = [];
  const countryMap = new Map(countries.map(feature => [featureId(feature), feature]));
  const unitMap = new Map(units.map(feature => [String(feature.id), feature]));
  const seenIds = new Set();
  for (const [unitIndex, unit] of units.entries()) {
    const id = String(unit.id || '');
    const properties = unit.properties || {};
    if (id && seenIds.has(id)) issues.push(issue('duplicate-id', `중복 영토 객체 ID ${id}가 있습니다.`, {
      entityRefs: [id], bounds: bounds(unit.geometry), sequence: unitIndex,
    }));
    if (id) seenIds.add(id);
    let countryId = '';
    try { countryId = territorialRootId(unit, key => unitMap.get(key) || countryMap.get(key)); }
    catch (error) { issues.push(issue('invalid-parent', error.message, { entityRefs: [id] })); }
    const parentId = String(properties.parentId || '');
    if (countryId && !countryMap.has(countryId)) issues.push(issue('invalid-sovereign', `${properties.name || id}의 countryId가 존재하지 않습니다.`, {
      entityRefs: [id, countryId], coordinate: bounds(unit.geometry)?.slice(0, 2),
    }));
    const parent = unitMap.get(parentId) || countryMap.get(parentId) || countryMap.get(countryId);
    if (parentId && !unitMap.has(parentId) && !countryMap.has(parentId)) issues.push(issue('orphan-administrative', `${properties.name || id}의 parentId가 존재하지 않습니다.`, {
      entityRefs: [id, parentId], bounds: bounds(unit.geometry),
    }));
    if (properties.coverageMode !== 'explicit' && clipper?.difference && parent?.geometry && unit.geometry) {
      const outside = clipGeometry('MultiPolygon', clipper.difference(multiCoordinates(unit.geometry), multiCoordinates(parent.geometry)));
      if (geometryPlanarArea(outside) > 1e-10) issues.push(issue('outside-parent', `${properties.name || id}이(가) 부모 영역 밖에 있습니다.`, {
        entityRefs: [id, featureId(parent)], geometry: outside, bounds: bounds(outside),
      }));
    }
  }
  return issues;
}

function validateDistributionReference(entries = [], units = []) {
  const unitIds = new Set(units.map(feature => String(feature.id)));
  const seenIds = new Set();
  const issues = [];
  entries.forEach((entry, entryIndex) => {
    const id = String(entry.id || '');
    if (id && seenIds.has(id)) issues.push(issue('duplicate-id', `중복 분포 ID ${id}가 있습니다.`, {
      entityRefs: [id], sequence: entryIndex,
    }));
    if (id) seenIds.add(id);
    if (entry.mode === 'territorial' && !unitIds.has(String(entry.territorialUnitId || ''))) {
      issues.push(issue('missing-territorial-reference', `분포가 존재하지 않는 territorialUnitId ${entry.territorialUnitId || '—'}를 참조합니다.`, {
        entityRefs: [id, String(entry.territorialUnitId || '')], severity: 'error', sequence: entryIndex,
      }));
    }
  });
  return issues;
}

export function runMapAudit({
  countries = [], coarseCountries = [], preciseAffectedIds = [], units = [], distributionEntries = [],
  clipper = null, affectedIds = null, baselineUnion = null,
} = {}) {
  const startedAt = globalThis.performance?.now?.() || Date.now();
  const diagnostics = {};
  const structuralAffectedIds = coarseCountries.length ? preciseAffectedIds : affectedIds;
  const structuralIssues = validateTerritorialGeometry(countries, {
    clipper: null,
    affectedIds: structuralAffectedIds,
    baselineUnion,
  });
  let overlapIssues;
  if (clipper && coarseCountries.length) {
    // The bundled canonical world is the validated baseline. Preview geometry
    // is intentionally simplified and can create false sliver overlaps, so a
    // project-wide audit performs exact clipping only for countries changed
    // since that baseline (imports are marked dirty as well).
    diagnostics.baselineCountryCount = coarseCountries.length;
    diagnostics.preciseAffectedCount = preciseAffectedIds.length;
    overlapIssues = [];
    if (preciseAffectedIds.length) {
      overlapIssues.push(...validateTerritorialGeometry(countries, {
        clipper, affectedIds: preciseAffectedIds, diagnostics,
      }).filter(item => item.kind === 'overlap'));
    }
    const seen = new Set();
    overlapIssues = overlapIssues.filter(item => {
      const key = `${item.kind}:${[...(item.entityRefs || [])].sort().join('|')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } else {
    overlapIssues = validateTerritorialGeometry(countries, { clipper, affectedIds, baselineUnion, diagnostics })
      .filter(item => item.kind === 'overlap' || item.kind === 'gap');
  }
  const issues = [
    ...structuralIssues,
    ...overlapIssues,
    ...validateAdministrativeContainment(units, countries, { clipper }),
    ...validateDistributionReference(distributionEntries, units),
  ];
  const counts = issues.reduce((output, item) => {
    output[item.kind] = (output[item.kind] || 0) + 1;
    return output;
  }, {});
  return {
    revision: 0,
    scope: affectedIds ? 'affected' : 'project',
    counts,
    issues,
    durationMs: (globalThis.performance?.now?.() || Date.now()) - startedAt,
    diagnostics,
    cancelled: false,
  };
}
