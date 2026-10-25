import { BUILTIN_SUBUNIT_REVISION } from './builtin-subunits.js';
import { MAP_SURFACE_HIGH_SCALE, MAP_SURFACE_MAX_ERROR_PX } from './country-mesh-zoom-policy.js';
export { BUILTIN_SUBUNIT_REVISION } from './builtin-subunits.js';

export const PROJECT_PREVIEW_ALGORITHM_REVISION = 'project-topology-4';
export const PROJECT_PREVIEW_MAX_BYTES = 16 * 1024 * 1024;

// Admission is tied to the exact source rings. Ring roles, winding and every
// shared source edge must retain the same path; topology inspection is supplied
// by the existing preview validator, not by a second geometry implementation.
const polygons = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
const pointKey = point => `${point[0]},${point[1]}`;
const edgeKey = (a, b) => a < b ? `${a}/${b}` : `${b}/${a}`;
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const unitPoint = ([lon, lat]) => {
  const a = lon * Math.PI / 180, b = lat * Math.PI / 180;
  return [Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), Math.sin(b)];
};
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function arc(a, b) {
  const normal = cross(a, b), length = Math.hypot(...normal), angle = Math.atan2(length, dot(a, b));
  if (length < 1e-14 || angle >= Math.PI - 1e-10) return null;
  const n = normal.map(value => value / length);
  return { a, n, tangent: cross(n, a), angle };
}
function arcMaximum(path, axis) {
  const a = dot(path.a, axis), b = dot(path.tangent, axis);
  let result = Math.max(Math.abs(a), Math.abs(a * Math.cos(path.angle) + b * Math.sin(path.angle)));
  const extremum = Math.atan2(b, a);
  for (const t of [extremum - Math.PI, extremum, extremum + Math.PI])
    if (t > 0 && t < path.angle) result = Math.max(result, Math.abs(a * Math.cos(t) + b * Math.sin(t)));
  return result;
}
// Bound the whole source great-circle arc, including extrema between vertices.
// Orthographic is 1-Lipschitz; 1/cos(latitude) also bounds equirectangular.
function sphericalEdgeErrorPx(sourceA, sourceB, retained) {
  const a = unitPoint(sourceA), b = unitPoint(sourceB), source = arc(a, b);
  if (!source || !retained) return Infinity;
  for (const point of [a,b]) {
    const t = Math.atan2(dot(point, retained.tangent), dot(point, retained.a));
    if (t < -1e-10 || t > retained.angle + 1e-10) return Infinity;
  }
  const sine = arcMaximum(source, retained.n);
  if (sine < 1e-14) return 0;
  const latitude = Math.max(arcMaximum(source, [0,0,1]), arcMaximum(retained, [0,0,1]));
  const deviation = Math.asin(Math.min(1,sine));
  const connectorLatitude = Math.min(Math.PI/2, Math.asin(Math.min(1,latitude)) + deviation);
  return deviation * MAP_SURFACE_HIGH_SCALE / Math.max(1e-12, Math.cos(connectorLatitude));
}

export function validatePreviewDisplay(canonical, preview, { inspectCandidate } = {}) {
  let maxErrorPx = 0;
  const reject = reason => ({ valid: false, maxErrorPx, reason });
  const open = ring => ring?.length >= 4 && pointKey(ring[0]) === pointKey(ring.at(-1)) ? ring.slice(0, -1) : [];
  const sources = new Map((canonical || []).map(row => [String(row.id), row]));
  if (!sources.size || sources.size !== canonical.length || preview?.length !== sources.size)
    return reject('source-identities');
  const seen = new Set(), edgeSelections = new Map();
  for (const candidate of preview) {
    const id = String(candidate.id), original = sources.get(id);
    if (!original || seen.has(id)) return reject('source-identities');
    seen.add(id);
    const sourcePolygons = polygons(original.geometry), candidates = polygons(candidate.geometry);
    if (!candidates.length || candidates.length !== sourcePolygons.length) return reject('polygon-count');
    for (let p = 0; p < candidates.length; p++) {
      if (candidates[p].length !== sourcePolygons[p].length) return reject('ring-count');
      for (let r = 0; r < candidates[p].length; r++) {
        const source = open(sourcePolygons[p][r]), points = open(candidates[p][r]);
        if (points.length < 3 || source.length < 3) return reject('open-ring');
        const indexesByKey = new Map(source.map((point, index) => [pointKey(point), index]));
        if (indexesByKey.size !== source.length || new Set(points.map(pointKey)).size !== points.length)
          return reject('repeated-vertex');
        if (!points.every(point => indexesByKey.has(pointKey(point)))) return reject('changed-vertices');
        const count = source.length, indexes = points.map(point => indexesByKey.get(pointKey(point)));
        if (indexes.reduce((total, index, i) => total + (indexes[(i + 1) % indexes.length] - index + count) % count, 0) !== count)
          return reject('ring-order');
        for (let i = 0; i < points.length; i++) {
          const a = points[i], b = points[(i + 1) % points.length];
          const retainedEdge = edgeKey(pointKey(a), pointKey(b));
          const retainedArc = arc(unitPoint(a), unitPoint(b));
          const wrap = value => value - 360 * Math.round(value / 360);
          const dx = wrap(b[0] - a[0]), dy = b[1] - a[1], length2 = dx * dx + dy * dy;
          if (!length2) return reject('collapsed-edge');
          const end = indexes[(i + 1) % indexes.length];
          let index = indexes[i];
          do {
            const next = (index + 1) % count, edge = edgeKey(pointKey(source[index]), pointKey(source[next]));
            if (edgeSelections.has(edge) && edgeSelections.get(edge) !== retainedEdge) return reject('shared-boundary');
            edgeSelections.set(edge, retainedEdge);
            if (indexes[(i + 1) % indexes.length] !== (indexes[i] + 1) % count) {
              maxErrorPx = Math.max(maxErrorPx, sphericalEdgeErrorPx(source[index], source[next], retainedArc));
              if (maxErrorPx > MAP_SURFACE_MAX_ERROR_PX) return reject('screen-error');
            }
            index = next;
            if (index === end) break;
            const point = source[index], px = wrap(point[0] - a[0]), py = point[1] - a[1];
            const t = Math.max(0, Math.min(1, (px * dx + py * dy) / length2));
            const error = Math.hypot(px - t * dx, py - t * dy) * Math.PI / 180 * MAP_SURFACE_HIGH_SCALE;
            if (!Number.isFinite(error)) return reject('invalid-coordinate');
            maxErrorPx = Math.max(maxErrorPx, error);
            if (maxErrorPx > MAP_SURFACE_MAX_ERROR_PX) return reject('screen-error');
          } while (index !== end);
        }
      }
    }
  }
  if (typeof inspectCandidate !== 'function') throw new TypeError('Preview admission requires the existing topology inspector.');
  if (inspectCandidate(preview).length) return reject('invalid-topology');
  return { valid: true, maxErrorPx, reason: '' };
}

// Physical land remains independent from object deletion and visibility. Apply
// the country's retained-vertex decisions to the physical source, then admit
// both together. Unowned land is preserved, including its islands and holes.
export function validateMapSurfacePreview(canonical, preview, landGeometries, { inspectCandidate } = {}) {
  const countries = validatePreviewDisplay(canonical, preview, { inspectCandidate });
  if (!countries.valid) return countries;
  if (!landGeometries.length) return { valid: false, maxErrorPx: countries.maxErrorPx, reason: 'land-unavailable' };
  const keys = features => new Set(features.flatMap(row => polygons(row.geometry).flatMap(polygon => polygon.flatMap(ring => ring.map(pointKey)))));
  const sourceKeys = keys(canonical), keptKeys = keys(preview);
  const landPreview = landGeometries.map(geometry => {
    const coordinates = polygons(geometry).map(polygon => polygon.map(ring => {
      const points = ring.slice(0, -1).filter(point => !sourceKeys.has(pointKey(point)) || keptKeys.has(pointKey(point)));
      return points.length ? [...points, points[0]] : [];
    }));
    return { type: geometry.type, coordinates: geometry.type === 'Polygon' ? coordinates[0] : coordinates };
  });
  const landRows = geometries => geometries.map((geometry, i) => ({ id: `\0physical-land:${i}`, geometry }));
  const candidateLand = landRows(landPreview);
  const certificate = validatePreviewDisplay([...canonical, ...landRows(landGeometries)], [...preview, ...candidateLand], {
    // Physical land overlaps countries by design. Validate its topology within
    // its own domain while checking shared source edges across both domains.
    inspectCandidate: () => [...inspectCandidate(preview), ...candidateLand.flatMap(row => inspectCandidate([row]))],
  });
  return certificate.valid ? { ...certificate, landGeometries: landPreview } : certificate;
}
function sourceEntities(source) {
  if (!source || !source.project || typeof source.project !== 'object' || Array.isArray(source.project)
    || !Array.isArray(source.territorialViews)) {
    throw Object.assign(new TypeError('Project preview requires the raw stored project and explicit Core territorial views.'),
      { code: 'PL-PREVIEW-SOURCE' });
  }
  if (source.project.format !== 'pandolab-autosave-delta') return source.territorialViews;
  const delta = source.project.entityDelta;
  if (!Array.isArray(delta?.changed) || !Array.isArray(delta.removedIds)) {
    throw Object.assign(new TypeError('Delta preview requires the original stored changed rows and removed IDs.'),
      { code: 'PL-PREVIEW-SOURCE' });
  }
  const changed = new Set(delta.changed.map(row => row.id));
  return source.territorialViews.filter(row => changed.has(row.id));
}

export function projectPreviewGeometryRows(source) {
  const entities = sourceEntities(source);
  const countries = entities.filter(feature => (feature.properties?.entityKind === 'general' && !feature.properties?.parentId));
  const removed = source.project.format === 'pandolab-autosave-delta' ? source.project.entityDelta.removedIds : [];
  return {
    countries: countries.map(feature => [String(feature.id), feature.geometry]).sort((a, b) => a[0].localeCompare(b[0])),
    removed: removed.map(String).sort(),
    units: entities.filter(feature => !(feature.properties?.entityKind === 'general' && !feature.properties?.parentId)).map(unit => [String(unit.id), unit.properties?.entityKind || '',
      String(unit.properties?.parentId || ''), unit.geometry])
      .sort((a, b) => a[0].localeCompare(b[0])),
  };
}

// The build and startup paths intentionally hash the same JSON representation.
// This is an identity check for derived display data, not a security boundary.
export function geometryFingerprint(geometry) {
  const source = JSON.stringify(geometry ?? null);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length.toString(36)}:${(hash >>> 0).toString(36)}`;
}

function unitsMatchDefault(units, expected) {
  if (!Array.isArray(units) || units.length !== Object.keys(expected).length) return false;
  const seen = new Set();
  for (const unit of units) {
    const id = String(unit?.id || '');
    const row = expected[id];
    if (!row || seen.has(id) || !(unit?.properties?.entityKind === 'general' && !!unit?.properties?.parentId)
      || String(unit?.properties?.parentId || '') !== row.parentId
      || unit?.properties?.metadata?.builtinSubunit?.revision !== BUILTIN_SUBUNIT_REVISION
      || geometryFingerprint(unit.geometry) !== row.geometry) return false;
    seen.add(id);
  }
  return true;
}

/** Only an exact canonical default-classification match may use the shipped preview. */
export function matchesDefaultPreview(source, baseline) {
  const entities = sourceEntities(source);
  const project = source.project;
  if (!baseline?.sourceSha256 || !baseline?.defaultClassification) return false;
  const expected = baseline.defaultClassification;
  if (!unitsMatchDefault(entities.filter(feature => !(feature.properties?.entityKind === 'general' && !feature.properties?.parentId)), expected.units || {})) return false;
  const expectedCountries = expected.countries || {};
  if (project.format === 'pandolab-autosave-delta') {
    const changed = entities.filter(feature => (feature.properties?.entityKind === 'general' && !feature.properties?.parentId));
    const removed = project.entityDelta?.removedIds || [];
    if (changed.length < Object.keys(expected.changed || {}).length
      || removed.length !== (expected.removedIds || []).length) return false;
    const removedSet = new Set(removed.map(String));
    if (removedSet.size !== removed.length || (expected.removedIds || []).some(id => !removedSet.has(id))) return false;
    const seen = new Set();
    for (const feature of changed) {
      const id = String(feature?.id || '');
      if (seen.has(id) || geometryFingerprint(feature.geometry) !== expectedCountries[id]) return false;
      seen.add(id);
    }
    return Object.keys(expected.changed || {}).every(id => seen.has(id));
  }
  const features = entities.filter(feature => (feature.properties?.entityKind === 'general' && !feature.properties?.parentId));
  if (!features || features.length !== Object.keys(expectedCountries).length) return false;
  const seen = new Set();
  for (const feature of features) {
    const id = String(feature?.id || '');
    if (seen.has(id) || geometryFingerprint(feature.geometry) !== expectedCountries[id]) return false;
    seen.add(id);
  }
  return true;
}

export function previewSourceForProject(source, baseline, cache) {
  if (matchesDefaultPreview(source, baseline)) return { kind: 'default' };
  if (cache?.algorithmRevision === PROJECT_PREVIEW_ALGORITHM_REVISION
    && cache?.baseSourceSha256 === baseline?.sourceSha256
    && cache?.geometryKey && Array.isArray(cache?.countries?.features)
    && Array.isArray(cache?.territorialUnits) && cache?.mesh?.positions) return { kind: 'project', cache };
  return { kind: 'restore' };
}
