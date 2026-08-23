'use strict';

const BUILD_ID = '0.16.3';
const COUNTRY_URL = new URL('../../data/countries-ne-5.1.1.geojson', self.location.href);
const MESH_URL = new URL('../../data/world-mesh-v0.12.6.bin.gz', self.location.href);
const LABEL_ANCHORS_URL = new URL('../../data/country-label-anchors-v0.10.1.json', self.location.href);
const progress = {
  countries: { loaded: 0, total: 0, done: false },
  mesh: { loaded: 0, total: 0, done: false },
  labelAnchors: { loaded: 0, total: 0, done: false },
};

function report(stage, message) {
  const items = Object.values(progress);
  const knownTotal = items.reduce((sum, item) => sum + (item.total || 0), 0);
  const knownLoaded = items.reduce((sum, item) => sum + Math.min(item.loaded, item.total || item.loaded), 0);
  const completed = items.filter(item => item.done).length;
  const percent = knownTotal > 0 ? Math.min(96, Math.round(knownLoaded / knownTotal * 92)) : completed * 30;
  self.postMessage({ type: 'progress', stage, message, percent });
}

async function fetchBytes(url, key, label) {
  const response = await fetch(url, { cache: 'default' });
  if (!response.ok) throw new Error(`${label} 요청에 실패했습니다. (${response.status})`);
  const total = Number(response.headers.get('content-length') || 0);
  progress[key].total = total;
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    progress[key].loaded = buffer.byteLength;
    progress[key].total ||= buffer.byteLength;
    progress[key].done = true;
    report(key, `${label}: 다운로드를 완료했습니다.`);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
    progress[key].loaded = length;
    report(key, `${label}: 다운로드하는 중입니다.`);
  }
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  progress[key].total ||= length;
  progress[key].done = true;
  report(key, `${label}: 다운로드를 완료했습니다.`);
  return merged.buffer;
}

async function loadCountries() {
  const buffer = await fetchBytes(COUNTRY_URL, 'countries', '국가 데이터');
  report('countries-parse', '국가 데이터를 해석하는 중입니다.');
  const data = JSON.parse(new TextDecoder().decode(buffer));
  if (data?.type !== 'FeatureCollection' || data.features?.length !== 258) {
    throw new Error('국가 데이터의 국가 수가 올바르지 않습니다.');
  }
  return data;
}

async function loadMesh() {
  if (typeof DecompressionStream !== 'function') throw new Error('이 브라우저는 GPU 메시 압축 해제를 지원하지 않습니다.');
  const compressed = await fetchBytes(MESH_URL, 'mesh', 'GPU 메시');
  report('mesh-decode', 'GPU 메시의 압축을 해제하는 중입니다.');
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  const header = new Uint32Array(buffer, 0, 8);
  if (header[0] !== 0x434d4731 || header[1] !== 1 || header[2] !== 258 || header[6] !== 548471 || header[7] !== 3) {
    throw new Error('GPU 메시 헤더가 올바르지 않습니다.');
  }
  return buffer;
}

async function loadLabelAnchors() {
  const buffer = await fetchBytes(LABEL_ANCHORS_URL, 'labelAnchors', '국명 기준점');
  const data = JSON.parse(new TextDecoder().decode(buffer));
  if (data?.version !== '0.10.1' || !data.anchors || Object.keys(data.anchors).length !== 258) {
    throw new Error('국명 기준점 데이터가 올바르지 않습니다.');
  }
  return data.anchors;
}

(async () => {
  try {
    report('start', '고해상도 지도 데이터를 요청하는 중입니다.');
    const [countries, meshBuffer, labelAnchors] = await Promise.all([loadCountries(), loadMesh(), loadLabelAnchors()]);
    self.postMessage({ type: 'ready', buildId: BUILD_ID, countries, meshBuffer, labelAnchors }, [meshBuffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
})();
