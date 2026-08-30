import {
  buildMetricRiverAnnexCandidates,
  expandRiverAnnexDiscoveryBounds,
  RIVER_ANNEX_ALGORITHM_REVISION,
  RIVER_ANNEX_CONFIG,
  riverAnnexConfigFingerprint,
} from './river-annex-metric.js';

const clone = value => value == null ? value : structuredClone(value);

function polygonCoordinates(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
}

function geometryFromCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return null;
  return { type: 'MultiPolygon', coordinates: clone(coordinates) };
}

function interpolate(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function planDrawnTerritoryAnnex({ drawnGeometry, donorFeatures = [], targetFeature = null, clipper } = {}) {
  if (!drawnGeometry || !clipper?.intersection || !clipper?.difference || !clipper?.union) return null;
  const donors = donorFeatures.filter(feature => polygonCoordinates(feature?.geometry).length);
  if (!donors.length || !targetFeature?.geometry) return null;
  const donorUnionCoordinates = clipper.union(...donors.map(feature => polygonCoordinates(feature.geometry)));
  let transferCoordinates = clipper.intersection(polygonCoordinates(drawnGeometry), donorUnionCoordinates);
  if (!transferCoordinates?.length) return null;
  transferCoordinates = clipper.difference(transferCoordinates, polygonCoordinates(targetFeature.geometry));
  const transferGeometry = geometryFromCoordinates(transferCoordinates);
  if (!transferGeometry) return null;
  const donorChanges = donors.map(feature => {
    const overlap = clipper.intersection(polygonCoordinates(feature.geometry), transferCoordinates);
    return { countryId: String(feature.properties?.editor_id || feature.id || ''), geometry: geometryFromCoordinates(overlap) };
  }).filter(item => item.geometry);
  return {
    transferGeometry,
    donorChanges,
    targetCountryId: String(targetFeature.properties?.editor_id || targetFeature.id || ''),
  };
}

// This epsilon is only for extracting shared political topology. River
// distance, direction, and connector decisions are all made in meters by the
// metric annex module and must never reuse this value.
const TOPOLOGY_COORDINATE_EPSILON = 1e-6;
const RIVER_ANNEX_MIN_EDGE_LENGTH = 1e-7;

function coordinateDistance(a, b) {
  return Math.hypot(Number(a?.[0]) - Number(b?.[0]), Number(a?.[1]) - Number(b?.[1]));
}

function segmentLength(a, b) {
  return coordinateDistance(a, b);
}

function projectionParameter(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-20) return 0;
  return ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
}

function pointNearSegment(point, a, b, tolerance) {
  const t = projectionParameter(point, a, b);
  if (t < -tolerance || t > 1 + tolerance) return false;
  return coordinateDistance(point, interpolate(a, b, Math.max(0, Math.min(1, t)))) <= tolerance;
}

function sharedOverlapSegment(a, b, c, d, tolerance = TOPOLOGY_COORDINATE_EPSILON) {
  if (segmentLength(a, b) <= tolerance || segmentLength(c, d) <= tolerance) return null;
  if (!pointNearSegment(c, a, b, tolerance) && !pointNearSegment(d, a, b, tolerance)
    && !pointNearSegment(a, c, d, tolerance) && !pointNearSegment(b, c, d, tolerance)) return null;
  const start = Math.max(0, Math.min(projectionParameter(c, a, b), projectionParameter(d, a, b)));
  const end = Math.min(1, Math.max(projectionParameter(c, a, b), projectionParameter(d, a, b)));
  if (end - start <= tolerance) return null;
  const left = interpolate(a, b, start);
  const right = interpolate(a, b, end);
  return segmentLength(left, right) > tolerance ? [left, right] : null;
}

function ringSegments(geometry) {
  const result = [];
  for (const polygon of polygonCoordinates(geometry)) {
    for (const ring of polygon || []) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        if (segmentLength(ring[index], ring[index + 1]) > RIVER_ANNEX_MIN_EDGE_LENGTH) result.push([ring[index], ring[index + 1]]);
      }
    }
  }
  return result;
}

export function sharedFrontierSegments(targetGeometry, donorGeometry, { tolerance = TOPOLOGY_COORDINATE_EPSILON } = {}) {
  const result = [];
  const seen = new Set();
  for (const [a, b] of ringSegments(targetGeometry)) {
    for (const [c, d] of ringSegments(donorGeometry)) {
      const overlap = sharedOverlapSegment(a, b, c, d, tolerance);
      if (!overlap) continue;
      const key = undirectedCoordinateKey(overlap[0], overlap[1]);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(overlap);
    }
  }
  return result;
}

function boundsForSegments(segments) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const segment of segments || []) for (const point of segment || []) {
    bounds[0] = Math.min(bounds[0], point[0]);
    bounds[1] = Math.min(bounds[1], point[1]);
    bounds[2] = Math.max(bounds[2], point[0]);
    bounds[3] = Math.max(bounds[3], point[1]);
  }
  return bounds.every(Number.isFinite) ? bounds : null;
}

export function riverAnnexDiscoveryBounds(targetGeometry, donorGeometries = [], options = {}) {
  const segments = donorGeometries.flatMap(geometry => sharedFrontierSegments(targetGeometry, geometry, options));
  return boundsForSegments(segments);
}

function coordinateKey(point, precision = 1e-8) {
  return `${Math.round(point[0] / precision)}:${Math.round(point[1] / precision)}`;
}

function undirectedCoordinateKey(a, b) {
  const left = coordinateKey(a);
  const right = coordinateKey(b);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

export function buildRiverAnnexCandidates({
  targetFeature = null,
  donorFeatures = [],
  riverFeatures = [],
  topologyRevision = '',
  snapTolerance = TOPOLOGY_COORDINATE_EPSILON,
  clipper = null,
  config = null,
  algorithmRevision = RIVER_ANNEX_ALGORITHM_REVISION,
  sourceDiagnostics = {},
} = {}) {
  const donorFrontiers = donorFeatures
    .filter(feature => polygonCoordinates(feature?.geometry).length)
    .map(donorFeature => ({
      donorFeature,
      segments: sharedFrontierSegments(targetFeature?.geometry, donorFeature.geometry, { tolerance: snapTolerance }),
    }))
    .filter(row => row.segments.length);
  return buildMetricRiverAnnexCandidates({
    targetFeature,
    donorFrontiers,
    riverFeatures,
    topologyRevision,
    clipper,
    config,
    algorithmRevision,
    sourceDiagnostics,
  });
}

export {
  expandRiverAnnexDiscoveryBounds,
  RIVER_ANNEX_ALGORITHM_REVISION,
  RIVER_ANNEX_CONFIG,
  riverAnnexConfigFingerprint,
};
