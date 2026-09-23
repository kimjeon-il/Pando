'use strict';

importScripts(
  '../vendor/topojson-client.min.js',
  '../vendor/topojson-server.min.js',
  '../vendor/topojson-simplify.min.js',
  '../vendor/polygon-clipping.min.js',
  '../vendor/earcut.min.js',
  '../modules/country-geometry.js',
  './gpu-mesh-core.js',
);

const modules = Promise.all([
  import('../modules/project-preview-topology.js'),
  import('../modules/geometry-validation.js'),
  import('../modules/country-stroke-preparation.js'),
  import('../modules/mesh-spatial-blocks.js'),
  import('../modules/project-preview-policy.js'),
]);

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function geometryKey(project, baseline) {
  const policy = (await modules)[4];
  return sha256({ source: baseline?.sourceSha256 || '', classification: policy.BUILTIN_SUBUNIT_REVISION,
    algorithm: policy.PROJECT_PREVIEW_ALGORITHM_REVISION, ...policy.projectPreviewGeometryRows(project) });
}

function bounds(geometry) {
  const result = [Infinity, Infinity, -Infinity, -Infinity];
  const scan = value => {
    if (typeof value?.[0] === 'number') {
      result[0] = Math.min(result[0], value[0]); result[1] = Math.min(result[1], value[1]);
      result[2] = Math.max(result[2], value[0]); result[3] = Math.max(result[3], value[1]);
    } else for (const part of value || []) scan(part);
  };
  scan(geometry.coordinates);
  return result;
}

function area(ring) {
  let total = 0;
  for (let index = 1; index < ring.length; index += 1) {
    total += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1];
  }
  return Math.abs(total) / 2;
}

function components(geometry) {
  return (geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates])
    .map(polygon => ({ polygon, box: bounds({ coordinates: polygon }) }));
}

function boxesOverlap(left, right) {
  return left[0] < right[2] && right[0] < left[2]
    && left[1] < right[3] && right[1] < left[3];
}

function intersectionIssues(features, unitParents) {
  const rows = features.map(feature => ({ id: String(feature.id), feature,
    components: components(feature.geometry), box: bounds(feature.geometry) }))
    .sort((a, b) => a.box[0] - b.box[0]);
  const isAncestor = (parent, child) => {
    let id = child;
    const seen = new Set();
    while (unitParents.has(id) && !seen.has(id)) {
      seen.add(id); id = unitParents.get(id);
      if (id === parent) return true;
    }
    return false;
  };
  const issues = [];
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    const left = rows[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const right = rows[rightIndex];
      if (right.box[0] > left.box[2]) break;
      if (right.box[1] > left.box[3] || right.box[3] < left.box[1]
        || isAncestor(left.id, right.id) || isAncestor(right.id, left.id)) continue;
      const points = [];
      for (const leftPart of left.components) for (const rightPart of right.components) {
        if (!boxesOverlap(leftPart.box, rightPart.box)) continue;
        const overlap = self.polygonClipping.intersection([leftPart.polygon], [rightPart.polygon]);
        for (const polygon of overlap || []) {
          const size = area(polygon[0]) - polygon.slice(1).reduce((sum, hole) => sum + area(hole), 0);
          if (size <= 1e-14) continue;
          const ring = polygon[0];
          const stride = Math.max(1, Math.floor(ring.length / 8));
          for (let index = 0; index < ring.length - 1 && points.length < 8; index += stride) points.push(ring[index]);
        }
      }
      if (points.length) issues.push({ ids: [left.id, right.id], points, reason: 'overlap' });
    }
  }
  return issues;
}

function ringRelation(point, ring) {
  let inside = false;
  for (let index = 1; index < ring.length; index += 1) {
    const a = ring[index - 1], b = ring[index];
    const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) <= 1e-12 * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]))
      && point[0] >= Math.min(a[0], b[0]) - 1e-12 && point[0] <= Math.max(a[0], b[0]) + 1e-12
      && point[1] >= Math.min(a[1], b[1]) - 1e-12 && point[1] <= Math.max(a[1], b[1]) + 1e-12) return 0;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 1 : -1;
}

function geometryRelation(point, parts) {
  for (const { polygon, box } of parts) {
    if (point[0] < box[0] || point[0] > box[2] || point[1] < box[1] || point[1] > box[3]) continue;
    const outer = ringRelation(point, polygon[0]);
    if (outer === 0) return 0;
    if (outer < 0) continue;
    let inHole = false;
    for (const hole of polygon.slice(1)) {
      const relation = ringRelation(point, hole);
      if (relation === 0) return 0;
      if (relation > 0) { inHole = true; break; }
    }
    if (!inHole) return 1;
  }
  return -1;
}

function segments(parts) {
  return parts.flatMap(({ polygon }) => polygon.flatMap(ring => ring.slice(0, -1).map((a, index) => {
    const b = ring[index + 1];
    return { a, b, box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
  })));
}

function properCrossing(first, second) {
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const a = orient(first.a, first.b, second.a), b = orient(first.a, first.b, second.b);
  const c = orient(second.a, second.b, first.a), d = orient(second.a, second.b, first.b);
  return a * b < -1e-24 && c * d < -1e-24;
}

function containmentIssue(child, parent) {
  const childParts = components(child), parentParts = components(parent);
  for (const { polygon } of childParts) for (const ring of polygon) for (const point of ring.slice(0, -1)) {
    if (geometryRelation(point, parentParts) < 0) return point;
  }
  const parentEdges = segments(parentParts);
  const parentBox = bounds(parent);
  const span = Math.max(1e-9, parentBox[2] - parentBox[0]);
  const buckets = Array.from({ length: 64 }, () => []);
  const bin = x => Math.max(0, Math.min(63, Math.floor((x - parentBox[0]) / span * 64)));
  for (const edge of parentEdges) for (let index = bin(edge.box[0]); index <= bin(edge.box[2]); index += 1) buckets[index].push(edge);
  for (const edge of segments(childParts)) {
    const checked = new Set();
    for (let index = bin(edge.box[0]); index <= bin(edge.box[2]); index += 1) for (const other of buckets[index]) {
      if (checked.has(other) || !boxesOverlap(edge.box, other.box)) continue;
      checked.add(other);
      if (properCrossing(edge, other)) return edge.a;
    }
  }
  // A parent hole can be wholly covered without crossing its boundary.
  for (const { polygon } of parentParts) for (const hole of polygon.slice(1)) {
    if (geometryRelation(hole[0], childParts) > 0) return hole[0];
  }
  return null;
}

function containmentIssues(features, requiredPairs) {
  const byId = new Map(features.map(feature => [String(feature.id), feature.geometry]));
  const issues = [];
  for (const [id, parentId] of requiredPairs) {
    const child = byId.get(id), parent = byId.get(parentId);
    if (!child || !parent) continue;
    const point = containmentIssue(child, parent);
    if (point) issues.push({ ids: [id, parentId], points: [point], reason: 'containment' });
  }
  return issues;
}

async function cacheIntegrity(cache) {
  const encoder = new TextEncoder();
  const parts = [encoder.encode(JSON.stringify({ countries: cache.countries,
    territorialUnits: cache.territorialUnits, countryIds: cache.countryIds }))];
  const visit = (value, key) => {
    if (!value || typeof value !== 'object') return;
    if (ArrayBuffer.isView(value)) {
      parts.push(encoder.encode(`${key}:${value.constructor.name}:${value.byteLength}:`));
      parts.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      return;
    }
    for (const [childKey, child] of Object.entries(value).sort((a, b) => a[0].localeCompare(b[0]))) {
      visit(child, `${key}.${childKey}`);
    }
  };
  visit(cache.mesh, 'mesh');
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const TYPED_ARRAYS = Object.freeze({ Int8Array, Uint8Array, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array });

async function packCache(cache) {
  const json = JSON.stringify(cache, (_key, value) => ArrayBuffer.isView(value)
    ? { __previewArray: value.constructor.name, values: Array.from(value) } : value);
  const compressed = await new Response(new Blob([json]).stream()
    .pipeThrough(new self.CompressionStream('gzip'))).arrayBuffer();
  return { algorithmRevision: cache.algorithmRevision, baseSourceSha256: cache.baseSourceSha256,
    geometryKey: cache.geometryKey, compressed };
}

async function unpackCache(record) {
  const text = await new Response(new Blob([record.compressed]).stream()
    .pipeThrough(new self.DecompressionStream('gzip'))).text();
  return JSON.parse(text, (_key, value) => value?.__previewArray
    ? new TYPED_ARRAYS[value.__previewArray](value.values) : value);
}

async function validateCache(project, baseline, cache) {
  const { PROJECT_PREVIEW_ALGORITHM_REVISION, PROJECT_PREVIEW_MAX_BYTES } = (await modules)[4];
  if (!cache || cache.algorithmRevision !== PROJECT_PREVIEW_ALGORITHM_REVISION
    || cache.baseSourceSha256 !== baseline?.sourceSha256
    || cache.geometryKey !== await geometryKey(project, baseline)
    || !(cache.compressed instanceof ArrayBuffer)
    || cache.compressed.byteLength > PROJECT_PREVIEW_MAX_BYTES) return null;
  const unpacked = await unpackCache(cache);
  if (!Array.isArray(unpacked.countries?.features) || !Array.isArray(unpacked.territorialUnits)
    || !Array.isArray(unpacked.countryIds) || !unpacked.mesh?.positions
    || unpacked.countryIds.length !== unpacked.countries.features.length) return null;
  const ids = unpacked.countries.features.map(feature => String(feature.id));
  if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== unpacked.countryIds[index])) return null;
  return await cacheIntegrity(unpacked) === unpacked.integrity ? unpacked : null;
}

async function buildCache(project, baseline, features, territorialUnits) {
  const [shared, geometryValidation, stroke, spatial, policy] = await modules;
  const key = await geometryKey(project, baseline);
  const current = features.map(feature => ({ type: 'Feature', id: String(feature.id),
    properties: feature.properties || {}, geometry: feature.geometry }));
  const units = territorialUnits.map(unit => ({ type: 'Feature', id: `unit:${unit.id}`,
    properties: { name: unit.properties?.name || '' }, geometry: unit.geometry }));
  const unitParents = new Map(territorialUnits.map(unit => [`unit:${unit.id}`,
    unit.properties?.parentId && territorialUnits.some(parent => String(parent.id) === String(unit.properties.parentId))
      ? `unit:${unit.properties.parentId}` : String(unit.properties?.sovereignId || unit.properties?.parentId || '')]));
  const originalById = new Map([...current, ...units].map(feature => [String(feature.id), feature.geometry]));
  const requiredContainment = [...unitParents].filter(([id, parentId]) => {
    const child = originalById.get(id), parent = originalById.get(parentId);
    return child && parent && !containmentIssue(child, parent);
  });
  const inspectCandidate = candidate => {
    const candidateFeatures = self.topojson.feature(candidate, candidate.objects.countries).features;
    const invalid = candidateFeatures.flatMap(feature => geometryValidation.validateGeometry(feature).map(issue => ({
      ids: [String(feature.id)], point: issue.point || null, reason: issue.kind || 'invalid',
    })));
    return invalid.length ? invalid : [
      ...intersectionIssues(candidateFeatures, unitParents),
      ...containmentIssues(candidateFeatures, requiredContainment),
    ];
  };
  const preview = shared.buildTopologyPreview([...current, ...units], {
    maxCoordinates: 150_000,
    normalizeGeometry: self.PandoLabCountryGeometry.normalizeCountryGeometry,
    hasCanonicalWinding: self.PandoLabCountryGeometry.hasCanonicalCountryWinding,
    topology: self.topojson.topology,
    presimplify: self.topojson.presimplify,
    quantile: self.topojson.quantile,
    topologyFeature: self.topojson.feature,
    validateGeometry: geometryValidation.validateGeometry,
    inspectCandidate,
  });
  const byId = new Map(preview.features.map(feature => [String(feature.id), feature]));
  const countries = { type: 'FeatureCollection', features: current.map(feature => byId.get(String(feature.id))) };
  const previewUnits = territorialUnits.map(unit => ({ id: unit.id, geometry: byId.get(`unit:${unit.id}`)?.geometry }));
  if (countries.features.some(feature => !feature) || previewUnits.some(unit => !unit.geometry)) throw new Error('미리보기 객체가 누락됐습니다.');
  const mesh = self.PandoLabGpuMeshCore.buildGpuMeshFeatures(countries.features, self.earcut,
    { validate: false, maxEdgeDegrees: 2 });
  const countryIds = countries.features.map(feature => String(feature.id));
  mesh.preparedStroke = stroke.prepareCountryStroke(mesh, countryIds);
  spatial.prepareMeshSpatialBlocks(mesh);
  const cache = { algorithmRevision: policy.PROJECT_PREVIEW_ALGORITHM_REVISION,
    baseSourceSha256: baseline.sourceSha256, geometryKey: key, countries, territorialUnits: previewUnits,
    countryIds, mesh };
  cache.integrity = await cacheIntegrity(cache);
  const packed = await packCache(cache);
  if (packed.compressed.byteLength > policy.PROJECT_PREVIEW_MAX_BYTES) throw new Error(`미리보기 캐시가 16MiB를 초과했습니다: ${packed.compressed.byteLength} bytes, ${preview.coordinateCount} coordinates`);
  return packed;
}

self.onmessage = async event => {
  const { id, type, project, baseline, cache, features, territorialUnits } = event.data || {};
  try {
    const result = type === 'key' ? await geometryKey(project, baseline)
      : type === 'validate' ? await validateCache(project, baseline, cache)
        : type === 'build' ? await buildCache(project, baseline, features || [], territorialUnits || [])
          : null;
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, message: error?.message || String(error) });
  }
};
