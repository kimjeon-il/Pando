import { resolveStartupLoadPolicy } from '../modules/startup-readiness.js?v=0.30.0-r28';

const BUILD_ID = '0.30.0';
const ASSET_REVISION = '0.30.0-r28';
const CORE_CACHE_PREFIX = 'pandolab-core-';
const CORE_CACHE_NAME = `${CORE_CACHE_PREFIX}${ASSET_REVISION}`;
const params = new URL(self.location.href).searchParams;
const loadPolicy = resolveStartupLoadPolicy({
  layout: params.get('layout') || 'wide',
  deviceMemory: params.get('deviceMemory') || null,
  hardwareConcurrency: params.get('hardwareConcurrency') || null,
  effectiveType: params.get('effectiveType') || '',
  saveData: params.get('saveData') === 'true',
});

function versionedDataUrl(relativePath) {
  const url = new URL(relativePath, self.location.href);
  url.searchParams.set('v', ASSET_REVISION);
  return url;
}

const MANIFEST_URL = versionedDataUrl('../../data/world-preview-v0.30.0.json');
const phaseProgress = { preview: new Map(), geometry: new Map(), mesh: new Map() };
let manifest = null;
let previewReady = false;
let geometryReady = false;
let meshReady = false;
let geometryLoading = false;
let meshLoading = false;
let meshCancelled = false;
let meshAbortController = null;
let coreCachePromise = null;
let oldCacheCleanupPromise = null;

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

async function openCoreCache() {
  if (!('caches' in self)) return null;
  if (!coreCachePromise) coreCachePromise = caches.open(CORE_CACHE_NAME).catch(() => null);
  return coreCachePromise;
}

async function cleanupOldCoreCaches() {
  if (!('caches' in self)) return;
  if (!oldCacheCleanupPromise) {
    oldCacheCleanupPromise = caches.keys()
      .then(names => Promise.all(names
        .filter(name => name.startsWith(CORE_CACHE_PREFIX) && name !== CORE_CACHE_NAME)
        .map(name => caches.delete(name))))
      .catch(() => []);
  }
  await oldCacheCleanupPromise;
}

async function cacheNetworkResponse(cache, url, response) {
  if (!cache) return false;
  try {
    await cache.put(url, response.clone());
    return true;
  } catch (_) {
    await cleanupOldCoreCaches();
    try {
      const retryResponse = await fetch(url, { cache: 'force-cache' });
      if (!retryResponse.ok) return false;
      await cache.put(url, retryResponse);
      return true;
    } catch (_) {
      return false;
    }
  }
}

function countedStream(stream, onChunk) {
  if (!stream || typeof TransformStream !== 'function') return stream;
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      onChunk(chunk.byteLength);
      controller.enqueue(chunk);
    },
  }));
}

async function consumeResponse(response, spec, phase, key, label, source) {
  const startedAt = performance.now();
  let storedBytes = 0;
  let decodedBytes = 0;
  const expectedStored = Number(spec.compressedBytes || 0);
  if (response.body && typeof TransformStream === 'function') {
    let stream = countedStream(response.body, length => {
      storedBytes += length;
      report(phase, key, `${label}: ${source === 'cache' ? '저장된 데이터를 읽는' : '다운로드하는'} 중입니다.`, storedBytes, expectedStored);
    });
    if (spec.encoding === 'gzip') {
      if (typeof DecompressionStream !== 'function') throw new Error(`이 브라우저는 ${label} 압축 해제를 지원하지 않습니다.`);
      report(phase, `${key}-decode`, `${label}: 압축을 해제하는 중입니다.`);
      stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }
    stream = countedStream(stream, length => { decodedBytes += length; });
    const buffer = await new Response(stream).arrayBuffer();
    decodedBytes = buffer.byteLength;
    return {
      buffer,
      source,
      transferredBytes: source === 'network' ? storedBytes : 0,
      storedBytes,
      decodedBytes,
      milliseconds: performance.now() - startedAt,
    };
  }

  const raw = await response.arrayBuffer();
  storedBytes = raw.byteLength;
  let buffer = raw;
  if (spec.encoding === 'gzip') {
    if (typeof DecompressionStream !== 'function') throw new Error(`이 브라우저는 ${label} 압축 해제를 지원하지 않습니다.`);
    const decoded = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    buffer = await new Response(decoded).arrayBuffer();
  }
  decodedBytes = buffer.byteLength;
  return {
    buffer,
    source,
    transferredBytes: source === 'network' ? storedBytes : 0,
    storedBytes,
    decodedBytes,
    milliseconds: performance.now() - startedAt,
  };
}

function resolveAssetUrl(spec) {
  return versionedDataUrl(`../../data/${String(spec.url || '')}`);
}

function validateAssetLength(result, spec, label) {
  const expected = Number(spec.decodedBytes || 0);
  if (expected <= 0 || result.buffer.byteLength === expected) return;
  if (spec.encoding === 'identity') {
    const normalized = new TextDecoder().decode(result.buffer).replaceAll('\r\n', '\n');
    if (new TextEncoder().encode(normalized).byteLength === expected) return;
  }
  throw new Error(`${label} 압축 해제 크기가 올바르지 않습니다.`);
}

async function loadAsset(spec, phase, key, label, validate, signal = null) {
  const url = resolveAssetUrl(spec);
  const cache = await openCoreCache();
  if (cache) {
    const cached = await cache.match(url).catch(() => null);
    if (cached) {
      try {
        const result = await consumeResponse(cached, spec, phase, key, label, 'cache');
        validateAssetLength(result, spec, label);
        const value = await validate(result.buffer, label);
        report(phase, key, `${label}: 저장된 데이터를 확인했습니다.`, Number(spec.compressedBytes || result.storedBytes), Number(spec.compressedBytes || result.storedBytes), true, { source: 'cache' });
        return { ...result, value, cacheHit: true };
      } catch (_) {
        await cache.delete(url).catch(() => false);
        report(phase, `${key}-cache-repair`, `${label}: 손상된 저장 데이터를 지우고 다시 받습니다.`, 1, 1, true, { source: 'cache', recovered: true });
      }
    }
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let cacheWrite = null;
    try {
      const response = await fetch(url, { cache: 'default', signal });
      if (!response.ok) throw new Error(`${label} 요청에 실패했습니다. (${response.status})`);
      cacheWrite = cacheNetworkResponse(cache, url, response);
      const result = await consumeResponse(response, spec, phase, key, label, 'network');
      validateAssetLength(result, spec, label);
      const value = await validate(result.buffer, label);
      const cached = await cacheWrite;
      report(phase, key, `${label}: 다운로드를 완료했습니다.`, Number(spec.compressedBytes || result.storedBytes), Number(spec.compressedBytes || result.storedBytes), true, { source: 'network', cached, attempt });
      return { ...result, value, cacheHit: false };
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError') throw error;
      if (cacheWrite) await cacheWrite.catch(() => false);
      if (cache) await cache.delete(url).catch(() => false);
      if (attempt < 3) {
        report(phase, `${key}-retry`, `${label} 준비를 다시 시도합니다. (${attempt + 1}/3)`, attempt, 3, false, { attempt });
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError || new Error(`${label}을 준비하지 못했습니다.`);
}

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
    const id = String(feature?.properties?.editor_id || '');
    if (!id || ids.has(id) || !['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) {
      throw new Error(`${label}의 국가 ID 또는 geometry가 올바르지 않습니다.`);
    }
    ids.add(id);
  }
  return data;
}

function validateMesh(buffer, spec, label) {
  const header = new Uint32Array(buffer, 0, 8);
  const expected = Array.isArray(spec.header) ? spec.header.map(Number) : [];
  if (header[0] !== 0x434d4731 || header[1] !== 1 || header[2] !== 258
      || (expected.length === 8 && expected.some((value, index) => header[index] !== value))) {
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
    parseMs: parseMilliseconds,
  };
}

async function loadManifest() {
  const response = await fetch(MANIFEST_URL, { cache: 'default' });
  if (!response.ok) throw new Error(`시작 데이터 manifest 요청에 실패했습니다. (${response.status})`);
  const value = await response.json();
  if (value?.version !== BUILD_ID || !value.assets?.previewCountries || !value.assets?.canonicalMesh) {
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
  previewReady = true;
  self.postMessage({
    type: 'preview-ready', buildId: BUILD_ID, countries: countryResult.data, meshBuffer, labelAnchors: labelAnchors.anchors,
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
  }, [meshBuffer]);
}

async function loadGeometry() {
  if (geometryLoading || geometryReady) return;
  geometryLoading = true;
  phaseProgress.geometry.clear();
  const startedAt = performance.now();
  report('geometry', 'start', '무손실 국가 데이터를 준비하는 중입니다.');
  try {
    const result = await loadJsonAsset(manifest.assets.canonicalCountries, 'geometry', 'countries', '원본 국가 데이터', true);
    const countriesSourceBuffer = result.buffer;
    geometryReady = true;
    self.postMessage({
      type: 'geometry-ready', buildId: BUILD_ID, countries: result.data, countriesSourceBuffer,
      postedEpochMs: performance.timeOrigin + performance.now(),
      metrics: {
        policy: loadPolicy,
        milliseconds: performance.now() - startedAt,
        transferredBytes: result.transferredBytes,
        decodedBytes: result.decodedBytes,
        assets: { countries: assetMetrics(result, result.parseMilliseconds) },
      },
    }, [countriesSourceBuffer]);
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
    meshReady = true;
    self.postMessage({
      type: 'mesh-ready', buildId: BUILD_ID, meshBuffer,
      postedEpochMs: performance.timeOrigin + performance.now(),
      metrics: {
        policy: loadPolicy,
        milliseconds: performance.now() - startedAt,
        transferredBytes: result.transferredBytes,
        decodedBytes: result.decodedBytes,
        assets: { mesh: assetMetrics(result) },
      },
    }, [meshBuffer]);
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

self.onmessage = event => {
  const type = event.data?.type;
  if (type === 'geometry-applied' && loadPolicy.mode === 'sequential') loadMesh();
  if ((type === 'retry-geometry' || type === 'retry-canonical') && previewReady && !geometryReady) loadGeometry();
  if ((type === 'retry-mesh' || type === 'retry-canonical') && previewReady && geometryReady && !meshReady) {
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
    await loadPreview();
    if (loadPolicy.mode === 'parallel') loadMesh();
    loadGeometry();
  } catch (error) {
    self.postMessage({ type: 'preview-error', message: error?.message || String(error) });
  }
})();
