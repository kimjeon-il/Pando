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
} = self.PandoLabCountryGeometry;

const countries = new Map();
const pendingResults = new Map();
const cancelled = new Set();
let currentDataRevision = 0;

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const featureId = feature => String(feature?.id || '');

function multiCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates || []];
  return geometry.type === 'MultiPolygon' ? geometry.coordinates || [] : [];
}

function quantizePolygonCoordinates(value, precision) {
  const factor = 10 ** precision;
  const visit = item => {
    if (Array.isArray(item) && item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1]))) {
      return [Math.round(Number(item[0]) * factor) / factor, Math.round(Number(item[1]) * factor) / factor];
    }
    return Array.isArray(item) ? item.map(visit) : item;
  };
  return visit(value);
}

function clippingOperation(method, ...inputs) {
  try {
    return self.polygonClipping[method](...inputs);
  } catch (error) {
    const message = String(error?.message || error || '');
    if (!/SweepLine tree|Unable to find segment/i.test(message)) throw error;
    for (const precision of [9, 8, 7, 6]) {
      try {
        return self.polygonClipping[method](...inputs.map(input => quantizePolygonCoordinates(input, precision)));
      } catch (retryError) {
        if (!/SweepLine tree|Unable to find segment/i.test(String(retryError?.message || retryError || ''))) throw retryError;
      }
    }
    throw error;
  }
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

function areaPolygonsNearFeatures(features, areaCoordinates) {
  const areaBounds = geometryBounds({ type: 'MultiPolygon', coordinates: areaCoordinates });
  const polygons = [];
  for (const feature of features) {
    for (const polygon of multiCoordinates(feature.geometry)) {
      if (boundsOverlap(polygonBounds(polygon), areaBounds)) polygons.push([polygon]);
    }
  }
  return polygons;
}

// Translate before summing: tiny slivers at large longitude/latitude otherwise
// lose their area to cancellation. This is an existence test, not a tolerance.
function localRingArea(ring, scaleX = 1, scaleY = 1) {
  const origin = ring?.[0];
  if (!origin) return 0;
  let sum = 0;
  for (let i = 1; i < ring.length; i += 1) {
    sum += (ring[i - 1][0] - origin[0]) * (ring[i][1] - origin[1])
      - (ring[i][0] - origin[0]) * (ring[i - 1][1] - origin[1]);
  }
  return Math.abs(sum / 2) * scaleX * scaleY;
}

function positivePolygonArea(polygon) {
  return localRingArea(polygon[0]) - polygon.slice(1).reduce((sum, ring) => sum + localRingArea(ring), 0) > 0;
}

function sliverAreaM2(polygon) {
  const bounds = polygonBounds(polygon);
  // Skip uncertain wraps/polar geometry rather than approximating it away.
  if (bounds[2] - bounds[0] > 1 || bounds[3] - bounds[1] > 1 || Math.max(Math.abs(bounds[1]), Math.abs(bounds[3])) > 80) return Infinity;
  const meters = 6371008.8 * Math.PI / 180;
  const x = meters * Math.cos((bounds[1] + bounds[3]) / 2 * Math.PI / 180);
  return Math.max(0, localRingArea(polygon[0], x, meters)
    - polygon.slice(1).reduce((sum, ring) => sum + localRingArea(ring, x, meters), 0));
}

function sharesBoundary(polygon, others) {
  // Only near-collinear overlapping edges, never proximity or point contact.
  const epsilon = 1e-11;
  for (const ring of polygon) for (let i = 1; i < ring.length; i += 1) {
    const a = ring[i - 1], b = ring[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (length <= epsilon) continue;
    for (const other of others) for (const otherRing of other) for (let j = 1; j < otherRing.length; j += 1) {
      const c = otherRing[j - 1], d = otherRing[j];
      if (Math.abs(dx * (c[1] - a[1]) - dy * (c[0] - a[0])) / length > epsilon
        || Math.abs(dx * (d[1] - a[1]) - dy * (d[0] - a[0])) / length > epsilon) continue;
      const start = ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / length;
      const end = ((d[0] - a[0]) * dx + (d[1] - a[1]) * dy) / length;
      if (Math.min(length, Math.max(start, end)) - Math.max(0, Math.min(start, end)) > epsilon) return true;
    }
  }
  return false;
}

function subtractAreaFromGeometry(geometry, areaCoordinates, { riverComponents = [], slivers = null } = {}) {
  const areaBounds = geometryBounds({ type: 'MultiPolygon', coordinates: areaCoordinates });
  const polygons = [];
  let affected = false;
  for (const [polygonIndex, polygon] of multiCoordinates(geometry).entries()) {
    if (!boundsOverlap(polygonBounds(polygon), areaBounds)) {
      polygons.push(clone(polygon));
      continue;
    }
    const source = [polygon];
    if (!clippingOperation('intersection', source, areaCoordinates).some(positivePolygonArea)) {
      polygons.push(clone(polygon));
      continue;
    }
    affected = true;
    const pieces = clippingOperation('difference', source, areaCoordinates);
    const component = riverComponents.find(row => row.polygonIndex === polygonIndex);
    const unselected = component?.unselectedGeometries?.flatMap(multiCoordinates);
    for (const piece of pieces) {
      const size = slivers && unselected ? sliverAreaM2(piece) : Infinity;
      if (size > 0 && size <= 1 && slivers.areaM2 + size <= 10
        && !clippingOperation('intersection', [piece], unselected).some(positivePolygonArea)
        && sharesBoundary(piece, areaCoordinates) && !sharesBoundary(piece, unselected)) {
        slivers.polygons.push(piece);
        slivers.areaM2 += size;
      } else polygons.push(piece);
    }
  }
  return { affected, geometry: normalizeCountryGeometry(polygons) };
}

function unionAreaWithGeometry(geometry, areaCoordinates) {
  const areaBounds = geometryBounds({ type: 'MultiPolygon', coordinates: areaCoordinates });
  const untouched = [];
  const nearby = [];
  for (const polygon of multiCoordinates(geometry)) {
    if (boundsOverlap(polygonBounds(polygon), areaBounds)) nearby.push([polygon]);
    else untouched.push(clone(polygon));
  }
  const merged = nearby.length ? clippingOperation('union', ...nearby, areaCoordinates) : clone(areaCoordinates);
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
  return inputs.length ? clippingOperation('union', ...inputs) : [];
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
      if (!overlaps.has(key)) overlaps.set(key, area(clippingOperation('intersection', left.geometry.coordinates, right.geometry.coordinates)));
    }
  }
  return {
    union: unionFeatures(map, affected),
    overlaps,
    boundaryLength: all.filter(feature => affected.has(featureId(feature))).reduce((sum, feature) => sum + boundaryLength(feature.geometry), 0),
  };
}

function validateResult(map, affectedIds, baseline, { allowAreaChange = false } = {}) {
  const affected = new Set([...affectedIds].map(String));
  const ids = [...map.keys()];
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('국가 ID가 비어 있거나 중복되었습니다.');
  for (const id of affected) {
    const feature = map.get(id);
    if (feature && !geometryValid(feature.geometry)) throw new Error(`${feature.properties?.name || id}의 경계가 유효하지 않습니다.`);
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
      const overlap = area(clippingOperation('intersection', feature.geometry.coordinates, other.geometry.coordinates));
      if (overlap > Number(baseline.overlaps.get(key) || 0) + tolerance) throw new Error('편집 결과에 새로운 국가 간 중첩이 생겼습니다. 범위를 조정하세요.');
    }
  }
  if (!allowAreaChange) {
    const changed = area(clippingOperation('xor', baseline.union, unionFeatures(map, affected)));
    if (changed > tolerance) throw new Error('편집 영역에 새로운 빈틈 또는 면적 변화가 생겼습니다. 범위를 조정하세요.');
  }
}

function applyPatch(map, features, removedIds, { cloneValues = false } = {}) {
  for (const id of removedIds || []) map.delete(String(id));
  for (const feature of features || []) map.set(featureId(feature), cloneValues ? clone(feature) : feature);
}

function executeAnnex(message, working) {
  const targetId = String(message.targetId || '');
  const allowUnclaimed = message.allowUnclaimed === true;
  const donorIds = [...new Set((message.donorIds || []).map(String))].filter(id => id && id !== targetId);
  const target = working.get(targetId);
  const donors = donorIds.map(id => working.get(id)).filter(Boolean);
  if (!target?.geometry || donors.length !== donorIds.length || (!allowUnclaimed && !donors.length)) throw new Error('편입할 국가 데이터를 찾을 수 없습니다. 대상을 다시 선택하세요.');
  let transferred = multiCoordinates(message.transferredGeometry);
  const transferredArea = area(transferred);
  if (!transferred.some(positivePolygonArea)) throw new Error('편입할 유효한 영토가 없습니다.');
  const donorInputs = areaPolygonsNearFeatures(donors, transferred);
  const donorUnion = donorInputs.length ? clippingOperation('union', ...donorInputs) : [];
  if (!allowUnclaimed && area(clippingOperation('difference', transferred, donorUnion)) > Math.max(1e-10, transferredArea * 1e-10)) {
    throw new Error('선택 영역이 영토를 가져올 국가 밖으로 벗어났습니다. 범위를 다시 지정하세요.');
  }
  const updates = [];
  const removedIds = [];
  const affectedDonorIds = [];
  const slivers = { polygons: [], areaM2: 0 };
  for (const donor of donors) {
    if (cancelled.has(message.requestId)) throw new Error('CANCELLED');
    const id = featureId(donor);
    const riverComponents = Array.isArray(message.riverSliverContext)
      ? message.riverSliverContext.filter(row => row.donorId === id && Number.isInteger(row.polygonIndex)
        && Array.isArray(row.unselectedGeometries)) : [];
    const subtraction = subtractAreaFromGeometry(donor.geometry, transferred, { riverComponents, slivers });
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
  if (!affectedDonorIds.length && !allowUnclaimed) throw new Error('선택 영역과 겹치는 국가가 없습니다.');
  if (slivers.polygons.length) transferred = clippingOperation('union', transferred, slivers.polygons);
  const nextTarget = clone(target);
  nextTarget.geometry = unionAreaWithGeometry(target.geometry, transferred);
  updates.unshift(nextTarget);
  const affectedIds = new Set([targetId, ...affectedDonorIds]);
  const baseline = captureBaseline(working, affectedIds);
  applyPatch(working, updates, removedIds);
  validateResult(working, new Set([targetId, ...affectedDonorIds]), baseline, { allowAreaChange: allowUnclaimed });
  return {
    features: updates, removedIds, affectedIds: [targetId, ...affectedDonorIds], affectedDonorIds,
    transferredArea: area(transferred), transferredGeometry: { type: 'MultiPolygon', coordinates: transferred },
    autoIncludedSlivers: { count: slivers.polygons.length, areaM2: slivers.areaM2 },
  };
}

function executeAnnexBatch(message, working) {
  const affectedIds = new Set();
  const affectedDonorIds = new Set();
  const transferredAreas = [];
  for (const item of message.operations || []) {
    const result = executeAnnex({ ...message, ...item }, working);
    for (const id of result.affectedIds || []) affectedIds.add(String(id));
    for (const id of result.affectedDonorIds || []) affectedDonorIds.add(String(id));
    transferredAreas.push(Number(result.transferredArea || 0));
  }
  const features = [...affectedIds].map(id => working.get(id)).filter(Boolean).map(clone);
  const removedIds = [...affectedIds].filter(id => !working.has(id));
  return {
    features,
    removedIds,
    affectedIds: [...affectedIds],
    affectedDonorIds: [...affectedDonorIds],
    transferredAreas,
  };
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
  next.geometry = normalizeCountryGeometry(clippingOperation('union', source.geometry.coordinates, ...targets.map(feature => feature.geometry.coordinates)));
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
  const sourceInputs = areaPolygonsNearFeatures(sources, transferred);
  const sourceUnion = sourceInputs.length ? clippingOperation('union', ...sourceInputs) : [];
  if (area(clippingOperation('difference', transferred, sourceUnion)) > Math.max(1e-10, transferredArea * 1e-10)) {
    throw new Error('선택 영역이 영토를 가져올 국가 밖으로 벗어났습니다.');
  }
  const updates = [];
  const removedIds = [];
  const affectedSourceIds = [];
  for (const source of sources) {
    const id = featureId(source);
    const subtraction = subtractAreaFromGeometry(source.geometry, transferred);
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
      for (const feature of message.features || []) countries.set(featureId(feature), feature);
      pendingResults.clear();
      currentDataRevision = Number(message.dataRevision || 0);
      self.postMessage({
        type: 'ready',
        dataRevision: currentDataRevision,
        geometryRevision: Number(message.geometryRevision || currentDataRevision),
        targetRevision: Number(message.targetRevision || 0),
      });
      return;
    }
    if (message.type === 'sync-patch') {
      if (Number(message.dataRevision || 0) < currentDataRevision) return;
      applyPatch(countries, message.features || [], message.removedIds || []);
      currentDataRevision = Number(message.dataRevision || currentDataRevision);
      return;
    }
    if (message.type === 'cancel') {
      cancelled.add(Number(message.requestId));
      return;
    }
    if (message.type === 'commit') {
      const pending = pendingResults.get(Number(message.requestId));
      if (pending && Number(pending.dataRevision) === currentDataRevision) {
        applyPatch(countries, pending.result.features, pending.result.removedIds);
        currentDataRevision = Number(message.nextDataRevision || currentDataRevision + 1);
      }
      pendingResults.delete(Number(message.requestId));
      return;
    }
    if (message.type === 'discard') {
      pendingResults.delete(Number(message.requestId));
      return;
    }
    if (message.type !== 'execute') return;
    if (Number(message.dataRevision || 0) !== currentDataRevision || cancelled.has(Number(message.requestId))) {
      throw new Error('CANCELLED');
    }
    const working = new Map(countries);
    const result = message.operation === 'merge'
      ? executeMerge(message, working)
      : message.operation === 'new-country'
        ? executeNewCountry(message, working)
        : message.operation === 'annex-batch'
          ? executeAnnexBatch(message, working)
          : executeAnnex(message, working);
    if (cancelled.has(Number(message.requestId))) throw new Error('CANCELLED');
    pendingResults.set(Number(message.requestId), {
      result,
      dataRevision: Number(message.dataRevision || 0),
      geometryRevision: Number(message.geometryRevision || message.dataRevision || 0),
      targetRevision: Number(message.targetRevision || 0),
      jobKey: String(message.jobKey || ''),
    });
    self.postMessage({
      type: 'result',
      ok: true,
      requestId: Number(message.requestId),
      jobKey: String(message.jobKey || ''),
      dataRevision: Number(message.dataRevision || 0),
      geometryRevision: Number(message.geometryRevision || message.dataRevision || 0),
      targetRevision: Number(message.targetRevision || 0),
      result,
    });
  } catch (error) {
    const cancelledRequest = error?.message === 'CANCELLED';
    self.postMessage({
      type: 'result', ok: false, cancelled: cancelledRequest,
      requestId: Number(message.requestId || 0), jobKey: String(message.jobKey || ''),
      dataRevision: Number(message.dataRevision || 0),
      geometryRevision: Number(message.geometryRevision || message.dataRevision || 0),
      targetRevision: Number(message.targetRevision || 0),
      message: cancelledRequest ? '작업을 취소했습니다.' : (error?.message || String(error)),
    });
  } finally {
    cancelled.delete(Number(message.requestId || 0));
  }
};
