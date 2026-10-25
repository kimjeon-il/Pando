'use strict';

// Hashing and cache validation require neither topology code nor a WASM heap.
// Only a genuine cache build initializes the heavyweight geometry runtime.
const previewPolicy = import("../../../../../shared/frontend/js/modules/project-preview-policy.js");
let buildModules = null;

function getBuildModules() {
  if (buildModules) return buildModules;
  buildModules = (async () => {
    importScripts(
      '../vendor/topojson-client.min.js',
      '../vendor/topojson-server.min.js',
      '../vendor/topojson-simplify.min.js',
      '../modules/polygon-clipping-core.js',
      '../modules/polygon-geometry.js',
      './gpu-mesh-core.js',
    );
    const { loadVerifiedCore } = await import("../../../../../shared/frontend/js/modules/core-wasm-loader.js");
    const core = await loadVerifiedCore({ baseUrl: new URL('../../wasm/', self.location.href) });
    self.PandoLabSphericalCore = core;
    self.PandoLabGpuMeshCore.setSharedCore(core);
    return Promise.all([
      import("../../../../../shared/frontend/js/modules/project-preview-topology.js"),
      import("../../../../../shared/frontend/js/modules/geometry-validation.js"),
      import("../../../../../shared/frontend/js/modules/country-stroke-preparation.js"),
      import("../../../../../shared/frontend/js/modules/mesh-spatial-blocks.js"),
    ]);
  })();
  return buildModules;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function geometryKey(source, baseline) {
  const policy = await previewPolicy;
  return sha256({ source: baseline?.sourceSha256 || '', classification: policy.BUILTIN_SUBUNIT_REVISION,
    algorithm: policy.PROJECT_PREVIEW_ALGORITHM_REVISION, ...policy.projectPreviewGeometryRows(source) });
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

async function validateCache(source, baseline, cache, preparedKey = null) {
  const { PROJECT_PREVIEW_ALGORITHM_REVISION, PROJECT_PREVIEW_MAX_BYTES } = await previewPolicy;
  const key = preparedKey ?? await geometryKey(source, baseline);
  if (!cache || cache.algorithmRevision !== PROJECT_PREVIEW_ALGORITHM_REVISION
    || cache.baseSourceSha256 !== baseline?.sourceSha256
    || cache.geometryKey !== key
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

async function buildCache(source, baseline, entities, preparedKey = null) {
  const key = preparedKey ?? await geometryKey(source, baseline);
  if (!Array.isArray(entities)) throw Object.assign(new TypeError('Accepted display entities are required to build a project preview.'),
    { code: 'PL-PREVIEW-SOURCE' });
  const features = entities.filter(entity => (entity.properties.entityKind === 'general' && !entity.properties.parentId));
  const territorialUnits = entities.filter(entity => !(entity.properties.entityKind === 'general' && !entity.properties.parentId));
  const [shared, geometryValidation, stroke, spatial] = await getBuildModules();
  const policy = await previewPolicy;
  const current = features.map(feature => ({ type: 'Feature', id: String(feature.id),
    properties: feature.properties || {}, geometry: feature.geometry }));
  const units = territorialUnits.map(unit => ({ type: 'Feature', id: `unit:${unit.id}`,
    properties: { name: unit.properties?.name || '' }, geometry: unit.geometry }));
  const unitParents = new Map(territorialUnits.map(unit => [`unit:${unit.id}`,
    unit.properties?.parentId && territorialUnits.some(parent => String(parent.id) === String(unit.properties.parentId))
      ? `unit:${unit.properties.parentId}` : String(unit.properties?.parentId || '')]));
  const originalById = new Map([...current, ...units].map(feature => [String(feature.id), feature.geometry]));
  const requiredContainment = [...unitParents].filter(([id, parentId]) => {
    const child = originalById.get(id), parent = originalById.get(parentId);
    return child && parent && !shared.previewContainmentIssue(child, parent);
  });
  const inspectCandidate = candidate => {
    const candidateFeatures = self.topojson.feature(candidate, candidate.objects.countries).features;
    return shared.inspectTopologyPreviewFeatures(candidateFeatures, {
      validateGeometry: geometryValidation.validateGeometry, clipper: self.polygonClipping,
      unitParents, requiredContainment,
    });
  };
  const preview = shared.buildTopologyPreview([...current, ...units], {
    maxCoordinates: 150_000,
    normalizeGeometry: self.PandoLabPolygonGeometry.normalizePolygonGeometry,
    hasCanonicalWinding: self.PandoLabPolygonGeometry.hasCanonicalPolygonWinding,
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
  const mesh = self.PandoLabGpuMeshCore.buildGpuMeshFeatures(countries.features,
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
  const { id, type, source, baseline, cache, entities, key } = event.data || {};
  try {
    const result = type === 'key' ? await geometryKey(source, baseline)
      : type === 'validate' ? await validateCache(source, baseline, cache, key)
        : type === 'build' ? await buildCache(source, baseline, entities, key)
          : null;
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, message: error?.message || String(error) });
  }
};
