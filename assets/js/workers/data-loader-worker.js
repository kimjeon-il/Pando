const workerAssetRevision = new URL(self.location.href).searchParams.get('v') || '';
await import(`../build-meta.js?v=${encodeURIComponent(workerAssetRevision)}`);
const buildMeta = globalThis.PANDOLAB_BUILD_META;
if (!buildMeta) throw new Error('빌드 메타데이터를 불러오지 못했습니다.');
const APP_VERSION = String(buildMeta.appVersion || '');
const ASSET_REVISION = String(buildMeta.assetRevision || workerAssetRevision);
const DATA_REVISION = String(buildMeta.dataRevision || `data-${APP_VERSION}`);
const { resolveStartupLoadPolicy } = await import(`../modules/startup-readiness.js?v=${encodeURIComponent(ASSET_REVISION)}`);
const {
  canonicalCountryPacketTransferables,
  inspectCanonicalCountryPacket,
} = await import(`../modules/canonical-country-packet.js?v=${encodeURIComponent(ASSET_REVISION)}`);
const { decodeCountryMesh } = await import(`../modules/country-mesh-codec.js?v=${encodeURIComponent(ASSET_REVISION)}`);
const { prepareCountryStroke, countryStrokeTransferables } = await import(`../modules/country-stroke-preparation.js?v=${encodeURIComponent(ASSET_REVISION)}`);
const { prepareMeshSpatialBlocks, spatialBlockTransferables } = await import(`../modules/mesh-spatial-blocks.js?v=${encodeURIComponent(ASSET_REVISION)}`);
let canonicalCountryIds = [];
const params = new URL(self.location.href).searchParams;
const builtinMeshOnly = params.get('mode') === 'builtin-mesh-only';
const loadPolicy = resolveStartupLoadPolicy({
  layout: params.get('layout') || 'wide',
  deviceMemory: params.get('deviceMemory') || null,
  hardwareConcurrency: params.get('hardwareConcurrency') || null,
  effectiveType: params.get('effectiveType') || '',
  saveData: params.get('saveData') === 'true',
});

function versionedDataUrl(relativePath) {
  const url = new URL(relativePath, self.location.href);
  url.searchParams.set('v', DATA_REVISION);
  return url;
}

const MANIFEST_URL = versionedDataUrl(`../../data/world-preview-v${APP_VERSION}.json`);
const phaseProgress = { preview: new Map(), geometry: new Map(), mesh: new Map() };
let manifest = null;
let previewReady = false;
let geometryReady = false;
let meshReady = false;
let geometryLoading = false;
let meshLoading = false;
let meshCancelled = false;
let meshAbortController = null;
let geometryStartRequested = false;
let geometryApplied = false;

function report(phase, key, message, loaded = 0, total = 0, done = false, extra = {}) {
  const progress = phaseProgress[phase];
  if (!progress) return;
  progress.set(key, { loaded, total, done });
  const items = [...progress.values()];
  const knownTotal = items.reduce((sum, item) => sum + (item.total || 0), 0);
  const knownLoaded = items.reduce((sum, item) => sum + Math.min(item.loaded, item.total || item.loaded), 0);
  const completed = items.filter(item => item.done).length;
  const percent = knownTotal > 0
    ? Math.min(99, Math.round(knownLoaded / knownTotal * 98))
    : Math.min(99, Math.round(completed / Math.max(1, items.length) * 98));
  self.postMessage({ type: `${phase}-progress`, phase, stage: key, message, percent, ...extra });
}

const { createStoredAssetLoader } = await import(`../modules/stored-asset-loader.js?v=${encodeURIComponent(ASSET_REVISION)}`);
const { loadAsset, cleanupOldCoreCaches } = createStoredAssetLoader({dataRevision: DATA_REVISION, resolveUrl: spec => versionedDataUrl(`../../data/${String(spec.url || '')}`), report});

async function parseJson(buffer) {
  const startedAt = performance.now();
  const value = JSON.parse(new TextDecoder().decode(buffer));
  return { value, parseMilliseconds: performance.now() - startedAt };
}

function validateCountries(data, label) {
  if (data?.type !== 'FeatureCollection' || data.features?.length !== 258) {
    throw new Error(`${label}의 국가 수가 올바르지 않습니다.`);
  }
  const ids = new Set();
  for (const feature of data.features) {
    const id = String(feature?.id || '');
    if (!id || ids.has(id) || !['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) {
      throw new Error(`${label}의 국가 ID 또는 geometry가 올바르지 않습니다.`);
    }
    ids.add(id);
  }
  return data;
}

function validateMesh(buffer, spec, label) {
  const prefix = new Uint32Array(buffer, 0, 8);
  const headerWords = prefix[1] >= 2 ? 12 : 8;
  const header = new Uint32Array(buffer, 0, headerWords);
  const expected = Array.isArray(spec.header) ? spec.header.map(Number) : [];
  const metadataValid = header[1] === 1 || (header[1] === 2
    && header[8] === header[2] * 2
    && header[9] === header[2] * 2
    && header[10] === header[2] * 4
    && header[11] === header[2]);
  const expectedHeaderValid = expected.length === headerWords
    && expected.every((value, index) => header[index] === value);
  if (header[0] !== 0x434d4731 || !metadataValid || header[2] !== 258
      || !expectedHeaderValid) {
    throw new Error(`${label} 헤더가 올바르지 않습니다.`);
  }
  return buffer;
}

function assetMetrics(result, parseMilliseconds = 0) {
  return {
    source: result.source,
    cacheHit: result.cacheHit,
    transferredBytes: result.transferredBytes,
    storedBytes: result.storedBytes,
    decodedBytes: result.decodedBytes,
    loadMs: result.milliseconds,
    cacheWriteMs: result.cacheWriteMs || 0,
    decompressMs: result.decompressMs || 0,
    parseMs: parseMilliseconds,
  };
}

async function loadManifest() {
  const response = await fetch(MANIFEST_URL, { cache: 'default' });
  if (!response.ok) throw new Error(`시작 데이터 manifest 요청에 실패했습니다. (${response.status})`);
  const value = await response.json();
  if (value?.version !== APP_VERSION || !value.assets?.previewCountries
      || !value.assets?.canonicalCountryPacket || !value.assets?.canonicalMesh) {
    throw new Error('시작 데이터 manifest 버전이 올바르지 않습니다.');
  }
  return value;
}

async function loadJsonAsset(spec, phase, key, label, countryCollection = false, signal = null) {
  let parseMilliseconds = 0;
  const result = await loadAsset(spec, phase, key, label, async buffer => {
    report(phase, `${key}-parse`, `${label}: 데이터를 해석하는 중입니다.`);
    const parsed = await parseJson(buffer);
    parseMilliseconds = parsed.parseMilliseconds;
    return countryCollection ? validateCountries(parsed.value, label) : parsed.value;
  }, signal);
  return { ...result, data: result.value, parseMilliseconds };
}

async function loadMeshAsset(spec, phase, key, label, signal = null) {
  const result = await loadAsset(spec, phase, key, label, buffer => validateMesh(buffer, spec, label), signal);
  return { ...result, buffer: result.value };
}

async function loadCountryPacketAsset(spec, phase, key, label, signal = null) {
  let packetHeader = null;
  let validateMilliseconds = 0;
  const result = await loadAsset(spec, phase, key, label, buffer => {
    const startedAt = performance.now();
    packetHeader = inspectCanonicalCountryPacket(buffer, Array.isArray(spec.header) ? spec.header : null);
    validateMilliseconds = performance.now() - startedAt;
    if (packetHeader.featureCount !== 258) throw new Error(`${label}의 국가 수가 올바르지 않습니다.`);
    return buffer;
  }, signal);
  return { ...result, buffer: result.value, packetHeader, validateMilliseconds };
}

async function loadPreview() {
  const startedAt = performance.now();
  report('preview', 'start', '빠른 미리보기 지도를 요청하는 중입니다.');
  const [countryResult, meshResult, anchorResult] = await Promise.all([
    loadJsonAsset(manifest.assets.previewCountries, 'preview', 'countries', '미리보기 국가 데이터', true),
    loadMeshAsset(manifest.assets.previewMesh, 'preview', 'mesh', '미리보기 GPU 메시'),
    loadJsonAsset(manifest.assets.labelAnchors, 'preview', 'labels', '국명 기준점'),
  ]);
  const labelAnchors = anchorResult.data;
  if (labelAnchors?.version !== '0.10.1' || !labelAnchors.anchors || Object.keys(labelAnchors.anchors).length !== 258) {
    throw new Error('국명 기준점 데이터가 올바르지 않습니다.');
  }
  const meshBuffer = meshResult.buffer;
  canonicalCountryIds = countryResult.data.features.map(feature => String(feature.id));
  const preparedStroke = prepareCountryStroke(decodeCountryMesh(meshBuffer, canonicalCountryIds).mesh, canonicalCountryIds);
  previewReady = true;
  self.postMessage({
    type: 'preview-ready', buildId: APP_VERSION, countries: countryResult.data, meshBuffer, preparedStroke, labelAnchors: labelAnchors.anchors,
    previewBaseline: { sourceSha256: manifest.sourceSha256, defaultClassification: manifest.defaultClassification },
    postedEpochMs: performance.timeOrigin + performance.now(),
    metrics: {
      policy: loadPolicy,
      milliseconds: performance.now() - startedAt,
      transferredBytes: countryResult.transferredBytes + meshResult.transferredBytes + anchorResult.transferredBytes,
      decodedBytes: countryResult.decodedBytes + meshResult.decodedBytes + anchorResult.decodedBytes,
      assets: {
        countries: assetMetrics(countryResult, countryResult.parseMilliseconds),
        mesh: assetMetrics(meshResult),
        labelAnchors: assetMetrics(anchorResult, anchorResult.parseMilliseconds),
      },
    },
  }, [meshBuffer, ...countryStrokeTransferables(preparedStroke)]);
}

async function loadGeometry() {
  if (geometryLoading || geometryReady) return;
  geometryLoading = true;
  phaseProgress.geometry.clear();
  const startedAt = performance.now();
  report('geometry', 'start', '무손실 국가 데이터를 준비하는 중입니다.');
  try {
    const result = await loadCountryPacketAsset(manifest.assets.canonicalCountryPacket, 'geometry', 'countries', '원본 국가 packet');
    const countryPacketBuffer = result.buffer;
    geometryReady = true;
    self.postMessage({
      type: 'geometry-ready', buildId: APP_VERSION, countryPacketBuffer, packetHeader: result.packetHeader,
      postedEpochMs: performance.timeOrigin + performance.now(),
      metrics: {
        policy: loadPolicy,
        milliseconds: performance.now() - startedAt,
        transferredBytes: result.transferredBytes,
        decodedBytes: result.decodedBytes,
        canonicalPacketCompressedBytes: result.storedBytes,
        canonicalPacketDecodedBytes: result.decodedBytes,
        canonicalCacheWriteMs: result.cacheWriteMs || 0,
        canonicalDecompressMs: result.decompressMs || 0,
        canonicalPacketValidateMs: result.validateMilliseconds,
        assets: { countryPacket: assetMetrics(result) },
      },
    }, canonicalCountryPacketTransferables(countryPacketBuffer));
    if (meshReady) cleanupOldCoreCaches();
  } catch (error) {
    self.postMessage({ type: 'geometry-error', message: error?.message || String(error) });
  } finally {
    geometryLoading = false;
  }
}

async function loadMesh() {
  if (meshLoading || meshReady || meshCancelled) return;
  meshLoading = true;
  phaseProgress.mesh.clear();
  meshAbortController = new AbortController();
  const startedAt = performance.now();
  report('mesh', 'start', '고화질 GPU 메시를 준비하는 중입니다.');
  try {
    const result = await loadMeshAsset(manifest.assets.canonicalMesh, 'mesh', 'mesh', '고화질 GPU 메시', meshAbortController.signal);
    if (meshCancelled) return;
    const meshBuffer = result.buffer;
    const decodedMesh = decodeCountryMesh(meshBuffer, canonicalCountryIds).mesh;
    // Stroke joins depend on original edge order; spatial line order is only for GL_LINES.
    const preparedStroke = prepareCountryStroke(decodedMesh, canonicalCountryIds);
    const originalTriangles = decodedMesh.triangleIndices, originalLines = decodedMesh.lineIndices;
    prepareMeshSpatialBlocks(decodedMesh);
    originalTriangles.set(decodedMesh.triangleIndices); originalLines.set(decodedMesh.lineIndices);
    const spatialBlocks = decodedMesh.spatialBlocks;
    if (meshCancelled) return;
    meshReady = true;
    self.postMessage({
      type: 'mesh-ready', buildId: APP_VERSION, meshBuffer, preparedStroke, spatialBlocks,
      identity: Object.freeze({
        hash: String(manifest.assets.canonicalMesh?.sha256 || ''),
        header: [...(manifest.assets.canonicalMesh?.header || [])].map(Number),
        dataRevision: DATA_REVISION,
        countryIds: [...canonicalCountryIds],
      }),
      postedEpochMs: performance.timeOrigin + performance.now(),
      metrics: {
        policy: loadPolicy,
        milliseconds: performance.now() - startedAt,
        transferredBytes: result.transferredBytes,
        decodedBytes: result.decodedBytes,
        assets: { mesh: assetMetrics(result) },
      },
    }, [meshBuffer, ...countryStrokeTransferables(preparedStroke), ...spatialBlockTransferables(decodedMesh)]);
    if (geometryReady) cleanupOldCoreCaches();
  } catch (error) {
    if (error?.name !== 'AbortError' && !meshCancelled) {
      self.postMessage({ type: 'mesh-error', message: error?.message || String(error) });
    }
  } finally {
    meshLoading = false;
    meshAbortController = null;
  }
}

async function loadBuiltinMeshOnly(countryIds) {
  const ids = [...(countryIds || [])].map(String).filter(Boolean);
  if (ids.length !== 258) throw new Error('내장 기본 메시 국가 ID가 올바르지 않습니다.');
  const result = await loadMeshAsset(manifest.assets.canonicalMesh, 'mesh', 'builtin-mesh', '내장 기본 GPU 메시');
  const meshBuffer = result.buffer;
  const decodedMesh = decodeCountryMesh(meshBuffer, ids).mesh;
  const preparedStroke = prepareCountryStroke(decodedMesh, ids);
  const originalTriangles = decodedMesh.triangleIndices, originalLines = decodedMesh.lineIndices;
  prepareMeshSpatialBlocks(decodedMesh);
  originalTriangles.set(decodedMesh.triangleIndices); originalLines.set(decodedMesh.lineIndices);
  const identity = Object.freeze({
    hash: String(manifest.assets.canonicalMesh?.sha256 || ''),
    header: [...(manifest.assets.canonicalMesh?.header || [])].map(Number),
    dataRevision: DATA_REVISION,
    countryIds: ids,
  });
  self.postMessage({
    type: 'builtin-mesh-ready', meshBuffer, preparedStroke, spatialBlocks: decodedMesh.spatialBlocks, identity,
  }, [meshBuffer, ...countryStrokeTransferables(preparedStroke), ...spatialBlockTransferables(decodedMesh)]);
}

self.onmessage = event => {
  const type = event.data?.type;
  if (builtinMeshOnly && type === 'load-builtin-mesh') {
    loadBuiltinMeshOnly(event.data?.countryIds).catch(error => {
      self.postMessage({ type: 'builtin-mesh-error', message: error?.message || String(error) });
    });
    return;
  }
  if (builtinMeshOnly) return;
  if (type === 'start-geometry' && previewReady && !geometryStartRequested) {
    geometryStartRequested = true;
    loadGeometry();
  }
  if (type === 'geometry-applied' && geometryReady && !geometryApplied) {
    geometryApplied = true;
    loadMesh();
  }
  if ((type === 'retry-geometry' || type === 'retry-canonical') && previewReady && !geometryReady) {
    geometryStartRequested = true;
    loadGeometry();
  }
  if ((type === 'retry-mesh' || type === 'retry-canonical') && previewReady && geometryReady && geometryApplied && !meshReady) {
    meshCancelled = false;
    loadMesh();
  }
  if (type === 'cancel-mesh') {
    meshCancelled = true;
    meshAbortController?.abort();
  }
};

(async () => {
  try {
    manifest = await loadManifest();
    if (builtinMeshOnly) {
      self.postMessage({ type: 'builtin-mesh-loader-ready' });
      return;
    }
    await loadPreview();
  } catch (error) {
    self.postMessage({ type: builtinMeshOnly ? 'builtin-mesh-error' : 'preview-error', message: error?.message || String(error) });
  }
})();
