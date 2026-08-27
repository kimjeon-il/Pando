'use strict';

const BUILD_ID = '0.29.0';
const PROFILE = new URL(self.location.href).searchParams.get('profile') === 'constrained' ? 'constrained' : 'standard';

function versionedDataUrl(relativePath) {
  const url = new URL(relativePath, self.location.href);
  const revision = new URL(self.location.href).searchParams.get('v');
  if (revision) url.searchParams.set('v', revision);
  return url;
}

const DATA_URLS = Object.freeze({
  previewCountries: versionedDataUrl('../../data/countries-preview-v0.29.0.geojson.gz'),
  previewMesh: versionedDataUrl('../../data/world-mesh-preview-v0.29.0.bin.gz'),
  canonicalCountries: versionedDataUrl('../../data/countries-ne-5.1.1.geojson'),
  canonicalMesh: versionedDataUrl('../../data/world-mesh-v0.12.6.bin.gz'),
  labelAnchors: versionedDataUrl('../../data/country-label-anchors-v0.10.1.json'),
});

const phaseProgress = {
  preview: new Map(),
  canonical: new Map(),
};
let previewReady = false;
let canonicalReady = false;
let canonicalLoading = false;

function report(phase, key, message, loaded = 0, total = 0, done = false, extra = {}) {
  phaseProgress[phase].set(key, { loaded, total, done });
  const items = [...phaseProgress[phase].values()];
  const knownTotal = items.reduce((sum, item) => sum + (item.total || 0), 0);
  const knownLoaded = items.reduce((sum, item) => sum + Math.min(item.loaded, item.total || item.loaded), 0);
  const completed = items.filter(item => item.done).length;
  const percent = knownTotal > 0
    ? Math.min(99, Math.round(knownLoaded / knownTotal * 98))
    : Math.min(99, Math.round(completed / Math.max(1, items.length) * 98));
  self.postMessage({ type: `${phase}-progress`, phase, stage: key, message, percent, ...extra });
}

async function fetchBytes(url, phase, key, label) {
  const startedAt = performance.now();
  const response = await fetch(url, { cache: 'default' });
  if (!response.ok) throw new Error(`${label} 요청에 실패했습니다. (${response.status})`);
  const headerTotal = Number(response.headers.get('content-length') || 0);
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    report(phase, key, `${label}: 다운로드를 완료했습니다.`, buffer.byteLength, headerTotal || buffer.byteLength, true);
    return { buffer, transferredBytes: buffer.byteLength, milliseconds: performance.now() - startedAt };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
    report(phase, key, `${label}: 다운로드하는 중입니다.`, length, headerTotal);
  }
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  report(phase, key, `${label}: 다운로드를 완료했습니다.`, length, headerTotal || length, true);
  return { buffer: merged.buffer, transferredBytes: length, milliseconds: performance.now() - startedAt };
}

async function gunzip(buffer, label) {
  if (typeof DecompressionStream !== 'function') throw new Error(`이 브라우저는 ${label} 압축 해제를 지원하지 않습니다.`);
  const startedAt = performance.now();
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  const decoded = await new Response(stream).arrayBuffer();
  return { buffer: decoded, milliseconds: performance.now() - startedAt };
}

function validateCountries(data, label) {
  if (data?.type !== 'FeatureCollection' || data.features?.length !== 258) {
    throw new Error(`${label}의 국가 수가 올바르지 않습니다.`);
  }
  return data;
}

function validateMesh(buffer, expectedSourceCoordinates, label) {
  const header = new Uint32Array(buffer, 0, 8);
  if (header[0] !== 0x434d4731 || header[1] !== 1 || header[2] !== 258
      || header[6] !== expectedSourceCoordinates || header[7] !== 3) {
    throw new Error(`${label} 헤더가 올바르지 않습니다.`);
  }
  return buffer;
}

async function loadJson(url, phase, key, label, compressed = false) {
  const download = await fetchBytes(url, phase, key, label);
  const decompression = compressed
    ? await gunzip(download.buffer, label)
    : { buffer: download.buffer, milliseconds: 0 };
  const rawBuffer = decompression.buffer;
  report(phase, `${key}-parse`, `${label}: 데이터를 해석하는 중입니다.`);
  const parseStartedAt = performance.now();
  const data = JSON.parse(new TextDecoder().decode(rawBuffer));
  return {
    data,
    sourceBuffer: rawBuffer,
    download,
    decodedBytes: rawBuffer.byteLength,
    decompressMilliseconds: decompression.milliseconds,
    parseMilliseconds: performance.now() - parseStartedAt,
  };
}

async function loadMesh(url, phase, key, label, expectedSourceCoordinates) {
  const download = await fetchBytes(url, phase, key, label);
  report(phase, `${key}-decode`, `${label}: 압축을 해제하는 중입니다.`);
  const decompression = await gunzip(download.buffer, label);
  const buffer = decompression.buffer;
  validateMesh(buffer, expectedSourceCoordinates, label);
  return {
    buffer,
    download,
    decodedBytes: buffer.byteLength,
    decompressMilliseconds: decompression.milliseconds,
    parseMilliseconds: 0,
  };
}

function assetMetrics(result) {
  return {
    transferredBytes: result.download.transferredBytes,
    decodedBytes: result.decodedBytes,
    downloadMs: result.download.milliseconds,
    decompressMs: result.decompressMilliseconds,
    parseMs: result.parseMilliseconds,
  };
}

async function loadPreview() {
  const startedAt = performance.now();
  report('preview', 'start', '빠른 미리보기 지도를 요청하는 중입니다.');
  const [countryResult, meshResult, anchorResult] = await Promise.all([
    loadJson(DATA_URLS.previewCountries, 'preview', 'countries', '미리보기 국가 데이터', true),
    loadMesh(DATA_URLS.previewMesh, 'preview', 'mesh', '미리보기 GPU 메시', 28_336),
    loadJson(DATA_URLS.labelAnchors, 'preview', 'labels', '국명 기준점'),
  ]);
  const countries = validateCountries(countryResult.data, '미리보기 국가 데이터');
  const labelAnchors = anchorResult.data;
  if (labelAnchors?.version !== '0.10.1' || !labelAnchors.anchors || Object.keys(labelAnchors.anchors).length !== 258) {
    throw new Error('국명 기준점 데이터가 올바르지 않습니다.');
  }
  const meshBuffer = meshResult.buffer;
  previewReady = true;
  self.postMessage({
    type: 'preview-ready', buildId: BUILD_ID, countries, meshBuffer, labelAnchors: labelAnchors.anchors,
    postedEpochMs: performance.timeOrigin + performance.now(),
    metrics: {
      profile: PROFILE,
      milliseconds: performance.now() - startedAt,
      transferredBytes: countryResult.download.transferredBytes + meshResult.download.transferredBytes + anchorResult.download.transferredBytes,
      decodedBytes: countryResult.decodedBytes + meshResult.decodedBytes + anchorResult.decodedBytes,
      assets: {
        countries: assetMetrics(countryResult),
        mesh: assetMetrics(meshResult),
        labelAnchors: assetMetrics(anchorResult),
      },
    },
  }, [meshBuffer]);
}

async function loadCanonicalOnce(attempt) {
  const startedAt = performance.now();
  phaseProgress.canonical.clear();
  report('canonical', 'start', '무손실 편집 데이터를 준비하는 중입니다.', 0, 0, false, { attempt });
  let countryResult;
  let meshResult;
  if (PROFILE === 'constrained') {
    countryResult = await loadJson(DATA_URLS.canonicalCountries, 'canonical', 'countries', '원본 국가 데이터');
    meshResult = await loadMesh(DATA_URLS.canonicalMesh, 'canonical', 'mesh', '무손실 GPU 메시', 548_466);
  } else {
    [countryResult, meshResult] = await Promise.all([
      loadJson(DATA_URLS.canonicalCountries, 'canonical', 'countries', '원본 국가 데이터'),
      loadMesh(DATA_URLS.canonicalMesh, 'canonical', 'mesh', '무손실 GPU 메시', 548_466),
    ]);
  }
  const countries = validateCountries(countryResult.data, '원본 국가 데이터');
  const countriesSourceBuffer = countryResult.sourceBuffer;
  const meshBuffer = meshResult.buffer;
  canonicalReady = true;
  self.postMessage({
    type: 'canonical-ready', buildId: BUILD_ID, countries, countriesSourceBuffer, meshBuffer,
    postedEpochMs: performance.timeOrigin + performance.now(),
    metrics: {
      profile: PROFILE,
      attempt,
      milliseconds: performance.now() - startedAt,
      transferredBytes: countryResult.download.transferredBytes + meshResult.download.transferredBytes,
      decodedBytes: countryResult.decodedBytes + meshResult.decodedBytes,
      assets: {
        countries: assetMetrics(countryResult),
        mesh: assetMetrics(meshResult),
      },
    },
  }, [countriesSourceBuffer, meshBuffer]);
}

async function loadCanonicalWithRetry() {
  if (canonicalLoading || canonicalReady) return;
  canonicalLoading = true;
  let lastError = null;
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await loadCanonicalOnce(attempt);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          const delay = 500 * 2 ** (attempt - 1);
          self.postMessage({
            type: 'canonical-progress', phase: 'canonical', stage: 'retry', percent: 0, attempt,
            message: `무손실 데이터 준비를 다시 시도합니다. (${attempt + 1}/3)`,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    self.postMessage({ type: 'canonical-error', message: lastError?.message || String(lastError) });
  } finally {
    canonicalLoading = false;
  }
}

self.onmessage = event => {
  if (event.data?.type === 'retry-canonical' && previewReady && !canonicalReady) loadCanonicalWithRetry();
};

(async () => {
  try {
    await loadPreview();
    await loadCanonicalWithRetry();
  } catch (error) {
    self.postMessage({ type: previewReady ? 'canonical-error' : 'preview-error', message: error?.message || String(error) });
  }
})();
