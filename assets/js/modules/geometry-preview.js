import { geometryAreaKm2, percentChange } from './geometry-metrics.js';

const clone = value => value == null ? value : structuredClone(value);
const idOf = feature => String(feature?.properties?.editor_id || feature?.id || '');
const STROKE_EPSILON = 1e-7;

function normalizeLongitude(value) {
  let longitude = Number(value || 0);
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function isArtificialPolygonClosureEdge(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const aLongitude = normalizeLongitude(a[0]);
  const bLongitude = normalizeLongitude(b[0]);
  const atPole = point => Math.abs(Math.abs(Number(point[1])) - 90) <= STROKE_EPSILON;
  const atDateLine = longitude => Math.abs(Math.abs(longitude) - 180) <= STROKE_EPSILON;
  return atPole(a)
    || atPole(b)
    || (atDateLine(aLongitude) && atDateLine(bLongitude))
    || Math.abs(aLongitude - bLongitude) > 180;
}

function appendPolygonStrokeLines(polygon, lines) {
  for (const ring of polygon || []) {
    if (!Array.isArray(ring) || ring.length < 2) continue;
    const first = ring[0];
    const last = ring.at(-1);
    const explicitlyClosed = Number(first?.[0]) === Number(last?.[0]) && Number(first?.[1]) === Number(last?.[1]);
    const edgeCount = explicitlyClosed ? ring.length - 1 : ring.length;
    for (let index = 0; index < edgeCount; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (!Array.isArray(a) || !Array.isArray(b) || isArtificialPolygonClosureEdge(a, b)) continue;
      lines.push([a, b]);
    }
  }
}

function appendStrokeLines(geometry, lines) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') appendPolygonStrokeLines(geometry.coordinates, lines);
  else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates || []) appendPolygonStrokeLines(polygon, lines);
  } else if (geometry.type === 'LineString') {
    if (geometry.coordinates?.length >= 2) lines.push(geometry.coordinates);
  } else if (geometry.type === 'MultiLineString') {
    for (const part of geometry.coordinates || []) if (part?.length >= 2) lines.push(part);
  } else if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries || []) appendStrokeLines(child, lines);
  }
}

function geometryHasArea(geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') return true;
  return geometry.type === 'GeometryCollection' && (geometry.geometries || []).some(geometryHasArea);
}

export function hasAreaGeometry(value) {
  if (value?.type === 'FeatureCollection') return (value.features || []).some(hasAreaGeometry);
  return geometryHasArea(value?.type === 'Feature' ? value.geometry : value);
}

export function buildRenderableStrokeFeature(value) {
  const lines = [];
  if (value?.type === 'FeatureCollection') {
    for (const feature of value.features || []) appendStrokeLines(feature?.geometry, lines);
  } else {
    appendStrokeLines(value?.type === 'Feature' ? value.geometry : value, lines);
  }
  return {
    type: 'Feature',
    properties: value?.type === 'Feature' ? (value.properties || {}) : {},
    geometry: { type: 'MultiLineString', coordinates: lines },
  };
}

export function createGeometryPreviewState() {
  return { revision: 0, session: null };
}

export function beginGeometryPreview(state, raw = {}) {
  state.revision += 1;
  state.session = {
    sessionId: raw.sessionId || `geometry-preview-${state.revision}`,
    operation: String(raw.operation || ''),
    baseDataRevision: Number(raw.baseDataRevision || 0),
    workerRequestId: Number(raw.workerRequestId || 0),
    affectedIds: [...new Set((raw.affectedIds || []).map(String))],
    beforeFeatures: clone(raw.beforeFeatures || []),
    afterFeatures: clone(raw.afterFeatures || []),
    removedIds: [...new Set((raw.removedIds || []).map(String))],
    delta: clone(raw.delta || null),
    metrics: clone(raw.metrics || null),
    validation: clone(raw.validation || { issues: [], blocking: false }),
    status: raw.status || 'ready',
    revision: state.revision,
  };
  return state.session;
}

export function clearGeometryPreview(state) {
  const previous = state.session;
  state.revision += 1;
  state.session = null;
  return previous;
}

export function previewIsCurrent(state, sessionId, baseDataRevision) {
  return !!state.session && state.session.sessionId === sessionId
    && Number(state.session.baseDataRevision) === Number(baseDataRevision);
}

function featureMap(features) {
  return new Map((features || []).map(feature => [idOf(feature), feature]).filter(([id]) => id));
}

function unionGeometry(features, clipper) {
  if (!features.length || !clipper?.union) return null;
  const coordinates = clipper.union(...features.map(feature => feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates));
  return coordinates?.length ? { type: 'MultiPolygon', coordinates } : null;
}

export function buildGeometryPreview({ operation, beforeFeatures = [], afterFeatures = [], removedIds = [], clipper = null, transferredGeometry = null } = {}) {
  const beforeById = featureMap(beforeFeatures);
  const afterById = featureMap(afterFeatures);
  const beforeUnion = unionGeometry(beforeFeatures, clipper);
  const afterUnion = unionGeometry(afterFeatures, clipper);
  let removedGeometry = null;
  let addedGeometry = null;
  if (clipper?.difference && beforeUnion && afterUnion) {
    const removed = clipper.difference(beforeUnion.coordinates, afterUnion.coordinates);
    const added = clipper.difference(afterUnion.coordinates, beforeUnion.coordinates);
    if (removed?.length) removedGeometry = { type: 'MultiPolygon', coordinates: removed };
    if (added?.length) addedGeometry = { type: 'MultiPolygon', coordinates: added };
  }
  if (transferredGeometry) {
    removedGeometry ||= clone(transferredGeometry);
    addedGeometry ||= clone(transferredGeometry);
  }
  if (operation === 'merge' && afterUnion) addedGeometry = clone(afterUnion);
  const perEntity = [...new Set([...beforeById.keys(), ...afterById.keys()])].map(id => {
    const before = geometryAreaKm2(beforeById.get(id)?.geometry);
    const after = geometryAreaKm2(afterById.get(id)?.geometry);
    return { id, before, after, delta: after - before, percent: percentChange(before, after) };
  });
  return {
    delta: {
      removedGeometry,
      addedGeometry,
      beforeUnion,
      afterUnion,
      newBoundaries: afterFeatures.map(feature => clone(feature.geometry)),
      oldBoundaries: beforeFeatures.map(feature => clone(feature.geometry)),
    },
    metrics: {
      operation,
      removedCountryCount: removedIds.length,
      finalAreaKm2: geometryAreaKm2(afterUnion),
      transferredAreaKm2: geometryAreaKm2(transferredGeometry),
      perEntity,
    },
  };
}
