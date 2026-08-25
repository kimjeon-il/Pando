'use strict';

function versionedWorkerAssetUrl(relativePath) {
  const url = new URL(relativePath, self.location.href);
  const revision = new URL(self.location.href).searchParams.get('v');
  if (revision) url.searchParams.set('v', revision);
  return url.href;
}

importScripts(
  versionedWorkerAssetUrl('../modules/country-geometry.js'),
  versionedWorkerAssetUrl('../vendor/polygon-clipping.min.js'),
);

const {
  hasCanonicalCountryWinding,
  normalizeCountryGeometry,
  ringSignedArea,
} = self.AtlasWrightCountryGeometry;

const countries = new Map();
const pendingResults = new Map();
const cancelled = new Set();

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const featureId = feature => String(feature?.properties?.editor_id || feature?.id || '');

function multiCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates || []];
  return geometry.type === 'MultiPolygon' ? geometry.coordinates || [] : [];
}

function area(value) {
  const polygons = value?.type ? multiCoordinates(value) : (Array.isArray(value) ? value : []);
  return polygons.reduce((total, polygon) => total + Math.max(0,
    Math.abs(ringSignedArea(polygon[0] || [])) - (polygon || []).slice(1).reduce((sum, ring) => sum + Math.abs(ringSignedArea(ring)), 0),
  ), 0);
}

function geometryBounds(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      bounds[0] = Math.min(bounds[0], Number(value[0])); bounds[1] = Math.min(bounds[1], Number(value[1]));
      bounds[2] = Math.max(bounds[2], Number(value[0])); bounds[3] = Math.max(bounds[3], Number(value[1]));
      return;
    }
    value.forEach(visit);
  };
  visit(geometry?.coordinates);
  return bounds;
}

function boundsOverlap(left, right) {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function polygonBounds(polygon) {
  return geometryBounds({ type: 'Polygon', coordinates: polygon });
}

function regionPolygonsNearFeatures(features, region) {
  const regionBounds = geometryBounds({ type: 'MultiPolygon', coordinates: region });
  const polygons = [];
  for (const feature of features) {
    for (const polygon of multiCoordinates(feature.geometry)) {
      if (boundsOverlap(polygonBounds(polygon), regionBounds)) polygons.push([polygon]);
    }
  }
  return polygons;
}

function subtractRegionFromGeometry(geometry, region, tolerance) {
  const regionBounds = geometryBounds({ type: 'MultiPolygon', coordinates: region });
  const polygons = [];
  let affected = false;
  for (const polygon of multiCoordinates(geometry)) {
    if (!boundsOverlap(polygonBounds(polygon), regionBounds)) {
      polygons.push(clone(polygon));
      continue;
    }
    const source = [polygon];
    if (area(self.polygonClipping.intersection(source, region)) <= tolerance) {
      polygons.push(clone(polygon));
      continue;
    }
    affected = true;
    polygons.push(...self.polygonClipping.difference(source, region));
  }
  return { affected, geometry: normalizeCountryGeometry(polygons) };
}

function unionRegionWithGeometry(geometry, region) {
  const regionBounds = geometryBounds({ type: 'MultiPolygon', coordinates: region });
  const untouched = [];
  const nearby = [];
  for (const polygon of multiCoordinates(geometry)) {
    if (boundsOverlap(polygonBounds(polygon), regionBounds)) nearby.push([polygon]);
    else untouched.push(clone(polygon));
  }
  const merged = nearby.length ? self.polygonClipping.union(...nearby, region) : clone(region);
  return normalizeCountryGeometry([...untouched, ...merged]);
}

function boundaryLength(geometry) {
  let length = 0;
  for (const polygon of multiCoordinates(geometry)) for (const ring of polygon || []) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      let dx = Number(ring[index + 1][0]) - Number(ring[index][0]);
      if (dx > 180) dx -= 360;
      if (dx < -180) dx += 360;
      length += Math.hypot(dx, Number(ring[index + 1][1]) - Number(ring[index][1]));
    }
  }
  return length;
}

function geometryValid(geometry) {
  const polygons = multiCoordinates(geometry);
  if (!polygons.length || !hasCanonicalCountryWinding(geometry)) return false;
  return polygons.every(polygon => polygon?.length && polygon.every(ring => {
    if (!Array.isArray(ring) || ring.length < 4) return false;
    const first = ring[0], last = ring[ring.length - 1];
    if (!first || !last || Math.abs(first[0] - last[0]) > 1e-7 || Math.abs(first[1] - last[1]) > 1e-7) return false;
    return new Set(ring.slice(0, -1).map(coord => `${Number(coord[0]).toFixed(8)},${Number(coord[1]).toFixed(8)}`)).size >= 3
      && Math.abs(ringSignedArea(ring)) > 1e-14;
  }));
}

function unionFeatures(map, ids) {
  const inputs = [...ids].map(id => map.get(String(id))?.geometry?.coordinates).filter(Boolean);
  return inputs.length ? self.polygonClipping.union(...inputs) : [];
}

function captureBaseline(map, affectedIds) {
  const affected = new Set([...affectedIds].map(String));
  const overlaps = new Map();
  const all = [...map.values()];
  for (const left of all) {
    const leftId = featureId(left);
    if (!affected.has(leftId)) continue;
    const leftBounds = geometryBounds(left.geometry);
    for (const right of all) {
      const rightId = featureId(right);
      if (!rightId || rightId === leftId || !boundsOverlap(leftBounds, geometryBounds(right.geometry))) continue;
      const key = leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
      if (!overlaps.has(key)) overlaps.set(key, area(self.polygonClipping.intersection(left.geometry.coordinates, right.geometry.coordinates)));
    }
  }
  return {
    union: unionFeatures(map, affected),
    overlaps,
    boundaryLength: all.filter(feature => affected.has(featureId(feature))).reduce((sum, feature) => sum + boundaryLength(feature.geometry), 0),
  };
}

function validateResult(map, affectedIds, baseline) {
  const affected = new Set([...affectedIds].map(String));
  const ids = [...map.keys()];
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('국가 ID가 비어 있거나 중복되었습니다.');
  for (const id of affected) {
    const feature = map.get(id);
    if (feature && !geometryValid(feature.geometry)) throw new Error(`${feature.properties?.editor_name || id}의 경계가 유효하지 않습니다.`);
  }
  const tolerance = Math.max(1e-8, Number(baseline.boundaryLength || 0) * 2e-7);
  const tested = new Set();
  for (const id of affected) {
    const feature = map.get(id);
    if (!feature) continue;
    const featureBounds = geometryBounds(feature.geometry);
    for (const other of map.values()) {
      const otherId = featureId(other);
      if (otherId === id || !boundsOverlap(featureBounds, geometryBounds(other.geometry))) continue;
      const key = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
      if (tested.has(key)) continue;
      tested.add(key);
      const overlap = area(self.polygonClipping.intersection(feature.geometry.coordinates, other.geometry.coordinates));
      if (overlap > Number(baseline.overlaps.get(key) || 0) + tolerance) throw new Error('편집 결과에 새로운 국가 간 중첩이 생겼습니다. 범위를 조정하세요.');
    }
  }
  const changed = area(self.polygonClipping.xor(baseline.union, unionFeatures(map, affected)));
  if (changed > tolerance) throw new Error('편집 영역에 새로운 빈틈 또는 면적 변화가 생겼습니다. 범위를 조정하세요.');
}

function applyPatch(map, features, removedIds) {
  for (const id of removedIds || []) map.delete(String(id));
  for (const feature of features || []) map.set(featureId(feature), clone(feature));
}

function executeAnnex(message, working) {
  const targetId = String(message.targetId || '');
  const donorIds = [...new Set((message.donorIds || []).map(String))].filter(id => id && id !== targetId);
  const target = working.get(targetId);
  const donors = donorIds.map(id => working.get(id)).filter(Boolean);
  if (!target?.geometry || donors.length !== donorIds.length || !donors.length) throw new Error('편입할 국가 데이터를 찾을 수 없습니다. 대상을 다시 선택하세요.');
  const transferred = multiCoordinates(message.transferredGeometry);
  const transferredArea = area(transferred);
  if (transferredArea <= 1e-14) throw new Error('편입할 유효한 영토가 없습니다.');
  const donorInputs = regionPolygonsNearFeatures(donors, transferred);
  const donorUnion = donorInputs.length ? self.polygonClipping.union(...donorInputs) : [];
  if (area(self.polygonClipping.difference(transferred, donorUnion)) > Math.max(1e-10, transferredArea * 1e-10)) {
    throw new Error('선택 영역이 영토를 가져올 국가 밖으로 벗어났습니다. 범위를 다시 지정하세요.');
  }
  const updates = [];
  const removedIds = [];
  const affectedDonorIds = [];
  const nextTarget = clone(target);
  nextTarget.geometry = unionRegionWithGeometry(target.geometry, transferred);
  updates.push(nextTarget);
  const tolerance = Math.max(1e-10, transferredArea * 1e-10);
  for (const donor of donors) {
    if (cancelled.has(message.requestId)) throw new Error('CANCELLED');
    const id = featureId(donor);
    const subtraction = subtractRegionFromGeometry(donor.geometry, transferred, tolerance);
    if (!subtraction.affected) continue;
    affectedDonorIds.push(id);
    const remainder = subtraction.geometry;
    if (!remainder) removedIds.push(id);
    else {
      const next = clone(donor);
      next.geometry = remainder;
      updates.push(next);
    }
  }
  if (!affectedDonorIds.length) throw new Error('선택 영역과 겹치는 국가가 없습니다.');
  const affectedIds = new Set([targetId, ...affectedDonorIds]);
  const baseline = captureBaseline(working, affectedIds);
  applyPatch(working, updates, removedIds);
  validateResult(working, new Set([targetId, ...affectedDonorIds]), baseline);
  return { features: updates, removedIds, affectedIds: [targetId, ...affectedDonorIds], affectedDonorIds, transferredArea };
}

function executeMerge(message, working) {
  const sourceId = String(message.sourceId || '');
  const targetIds = [...new Set((message.targetIds || []).map(String))].filter(id => id && id !== sourceId);
  const source = working.get(sourceId);
  const targets = targetIds.map(id => working.get(id)).filter(Boolean);
  if (!source?.geometry || targets.length !== targetIds.length || !targets.length) throw new Error('합병할 국가를 찾을 수 없습니다. 대상을 다시 선택하세요.');
  const affectedIds = new Set([sourceId, ...targetIds]);
  const baseline = captureBaseline(working, affectedIds);
  const next = clone(source);
  next.geometry = normalizeCountryGeometry(self.polygonClipping.union(source.geometry.coordinates, ...targets.map(feature => feature.geometry.coordinates)));
  next.properties.pop_est = Number(source.properties?.pop_est || 0) + targets.reduce((sum, feature) => sum + Number(feature.properties?.pop_est || 0), 0);
  next.properties.gdp_md_est = Number(source.properties?.gdp_md_est || 0) + targets.reduce((sum, feature) => sum + Number(feature.properties?.gdp_md_est || 0), 0);
  applyPatch(working, [next], targetIds);
  validateResult(working, affectedIds, baseline);
  return { features: [next], removedIds: targetIds, affectedIds: [...affectedIds], seamless: true };
}

function executeNewCountry(message, working) {
  const sourceIds = [...new Set((message.sourceIds || []).map(String))].filter(Boolean);
  const sources = sourceIds.map(id => working.get(id)).filter(Boolean);
  const newFeature = clone(message.newFeature);
  const newId = featureId(newFeature);
  if (!sources.length || sources.length !== sourceIds.length || !newFeature?.geometry || !newId) throw new Error('새 국가의 원본 국가 데이터를 찾을 수 없습니다.');
  const transferred = multiCoordinates(message.transferredGeometry);
  const transferredArea = area(transferred);
  const sourceInputs = regionPolygonsNearFeatures(sources, transferred);
  const sourceUnion = sourceInputs.length ? self.polygonClipping.union(...sourceInputs) : [];
  if (area(self.polygonClipping.difference(transferred, sourceUnion)) > Math.max(1e-10, transferredArea * 1e-10)) {
    throw new Error('선택 영역이 영토를 가져올 국가 밖으로 벗어났습니다.');
  }
  const updates = [];
  const removedIds = [];
  const affectedSourceIds = [];
  const tolerance = Math.max(1e-10, transferredArea * 1e-10);
  for (const source of sources) {
    const id = featureId(source);
    const subtraction = subtractRegionFromGeometry(source.geometry, transferred, tolerance);
    if (!subtraction.affected) continue;
    affectedSourceIds.push(id);
    const remainder = subtraction.geometry;
    if (!remainder) removedIds.push(id);
    else {
      const next = clone(source);
      next.geometry = remainder;
      updates.push(next);
    }
  }
  if (!affectedSourceIds.length) throw new Error('선택 영역과 겹치는 국가가 없습니다.');
  const baseline = captureBaseline(working, new Set(affectedSourceIds));
  newFeature.geometry = normalizeCountryGeometry(transferred);
  updates.push(newFeature);
  applyPatch(working, updates, removedIds);
  const affectedIds = new Set([...affectedSourceIds, newId]);
  validateResult(working, affectedIds, baseline);
  return { features: updates, removedIds, affectedIds: [...affectedIds], affectedSourceIds, transferredArea, newCountryId: newId };
}

self.onmessage = event => {
  const message = event.data || {};
  try {
    if (message.type === 'rebase') {
      countries.clear();
      for (const feature of message.features || []) countries.set(featureId(feature), clone(feature));
      pendingResults.clear();
      self.postMessage({ type: 'ready', dataRevision: Number(message.dataRevision || 0) });
      return;
    }
    if (message.type === 'sync-patch') {
      applyPatch(countries, message.features || [], message.removedIds || []);
      return;
    }
    if (message.type === 'cancel') {
      cancelled.add(Number(message.requestId));
      return;
    }
    if (message.type === 'commit') {
      const result = pendingResults.get(Number(message.requestId));
      if (result) applyPatch(countries, result.features, result.removedIds);
      pendingResults.delete(Number(message.requestId));
      return;
    }
    if (message.type === 'discard') {
      pendingResults.delete(Number(message.requestId));
      return;
    }
    if (message.type !== 'execute') return;
    const working = new Map([...countries].map(([id, feature]) => [id, clone(feature)]));
    const result = message.operation === 'merge'
      ? executeMerge(message, working)
      : message.operation === 'new-country'
        ? executeNewCountry(message, working)
        : executeAnnex(message, working);
    pendingResults.set(Number(message.requestId), result);
    self.postMessage({ type: 'result', ok: true, requestId: Number(message.requestId), dataRevision: Number(message.dataRevision || 0), result });
  } catch (error) {
    const cancelledRequest = error?.message === 'CANCELLED';
    self.postMessage({
      type: 'result', ok: false, cancelled: cancelledRequest,
      requestId: Number(message.requestId || 0), dataRevision: Number(message.dataRevision || 0),
      message: cancelledRequest ? '작업을 취소했습니다.' : (error?.message || String(error)),
    });
  } finally {
    cancelled.delete(Number(message.requestId || 0));
  }
};
