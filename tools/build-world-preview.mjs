import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { validateGeometry } from '../assets/js/modules/geometry-validation.js';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, '..');
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;
const dataDirectory = path.join(projectRoot, 'assets', 'data');
const sourcePath = path.join(projectRoot, 'assets', 'data', 'countries-ne-5.1.1.geojson');
const previewSourcePath = path.join(projectRoot, 'assets', 'data', 'countries-ne-5.1.1-50m.geojson');
const canonicalCountriesGzipPath = path.join(projectRoot, 'assets', 'data', 'countries-ne-5.1.1.geojson.gz');
const canonicalMeshPath = path.join(projectRoot, 'assets', 'data', 'world-mesh-v0.12.6.bin.gz');
const labelAnchorsPath = path.join(projectRoot, 'assets', 'data', 'country-label-anchors-v0.10.1.json');
const previewCountriesPath = path.join(projectRoot, 'assets', 'data', `countries-preview-v${APP_VERSION}.geojson.gz`);
const previewMeshPath = path.join(projectRoot, 'assets', 'data', `world-mesh-preview-v${APP_VERSION}.bin.gz`);
const previewManifestPath = path.join(projectRoot, 'assets', 'data', `world-preview-v${APP_VERSION}.json`);
const checkOnly = process.argv.includes('--check');

const MAX_COORDINATES = 120_000;
const MAX_COMPRESSED_BYTES = 3 * 1024 * 1024;
const EXPECTED_SUPPLEMENTED_COUNTRY_IDS = new Set(['BJN', 'BRI', 'BRT', 'CLP', 'CNM', 'CSI', 'ESB', 'GIB', 'KAB', 'PGA', 'SCR', 'SER', 'SPI', 'UMI', 'USG', 'WSB']);

function loadClassicScript(relativePath, globalName) {
  const filePath = path.join(projectRoot, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, 'utf8'), { filename: filePath });
  const value = globalThis[globalName];
  if (!value) throw new Error(`${relativePath}에서 ${globalName}을 불러오지 못했습니다.`);
  return value;
}

const d3 = loadClassicScript(path.join('assets', 'js', 'vendor', 'd3.min.js'), 'd3');
const earcut = loadClassicScript(path.join('assets', 'js', 'vendor', 'earcut.min.js'), 'earcut');
const countryGeometry = loadClassicScript(path.join('assets', 'js', 'modules', 'country-geometry.js'), 'PandoLabCountryGeometry');
const meshCore = loadClassicScript(path.join('assets', 'js', 'workers', 'gpu-mesh-core.js'), 'PandoLabGpuMeshCore');

function countCoordinates(value) {
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return 1;
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => sum + countCoordinates(item), 0);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function meshHeader(value) {
  return Array.from(new Uint32Array(value.buffer, value.byteOffset, 8));
}

function countryId(value, fallback = '') {
  const id = value?.id ?? value?.properties?.editor_id ?? value?.properties?.iso_a3 ?? fallback;
  return String(id || '').trim();
}

function sourceCountryId(featureValue) {
  const properties = featureValue?.properties || {};
  for (const value of [properties.ADM0_A3, properties.ISO_A3, featureValue?.id]) {
    const id = String(value ?? '').trim();
    if (id && !['-99', '-1', 'null', 'undefined'].includes(id)) return id;
  }
  return '';
}

function minimalFeature(featureValue, index) {
  const properties = featureValue.properties || {};
  return {
    type: 'Feature',
    id: countryId(featureValue, String(index)),
    properties: { name: properties.name || properties.NAME || '이름 없는 국가' },
    geometry: featureValue.geometry,
  };
}

function canonicalFeatureIssues(featureValue) {
  const issues = validateGeometry(featureValue);
  if (!countryGeometry.hasCanonicalCountryWinding(featureValue?.geometry)) {
    issues.push({ kind: 'noncanonical-winding', message: '국가 고리 방향 또는 구조가 canonical 규격과 다릅니다.' });
  }
  return issues;
}

function normalizePreviewFeature(featureValue) {
  const geometry = countryGeometry.normalizeCountryGeometry(featureValue.geometry);
  if (!geometry) return null;
  return { ...featureValue, geometry };
}

function buildPreview(canonicalSource, source50, existingPreview) {
  const canonicalFeatures = canonicalSource.features.map(minimalFeature);
  const canonicalIds = canonicalFeatures.map(featureValue => featureValue.id);
  if (canonicalFeatures.length !== 258 || new Set(canonicalIds).size !== 258) throw new Error('canonical 국가 목록은 중복 없는 258개여야 합니다.');

  const sourceById = new Map();
  for (const featureValue of source50.features) {
    const id = sourceCountryId(featureValue);
    if (!id) throw new Error('50m 국가 geometry에 ADM0_A3/ISO_A3가 없습니다.');
    if (sourceById.has(id)) throw new Error(`50m 국가 ID가 중복됩니다: ${id}`);
    sourceById.set(id, featureValue);
  }
  const canonicalSet = new Set(canonicalIds);
  const unknownSourceIds = [...sourceById.keys()].filter(id => !canonicalSet.has(id));
  if (unknownSourceIds.length) throw new Error(`50m source에 canonical에 없는 국가 ID가 있습니다: ${unknownSourceIds.join(', ')}`);

  const existingById = new Map(existingPreview.features.map(featureValue => [countryId(featureValue), featureValue]));
  const supplementedCountryIds = [];
  const features = canonicalFeatures.map(canonicalFeature => {
    const id = canonicalFeature.id;
    const sourceFeature = sourceById.get(id);
    let candidate = sourceFeature ? { ...canonicalFeature, geometry: sourceFeature.geometry } : existingById.get(id);
    if (!sourceFeature) supplementedCountryIds.push(id);
    if (!candidate) throw new Error(`50m geometry와 기존 preview 보완 geometry 모두 없습니다: ${id}`);
    candidate = normalizePreviewFeature(candidate);
    if (!candidate) throw new Error(`미리보기 geometry가 비어 있습니다: ${id}`);
    const issues = canonicalFeatureIssues(candidate);
    if (issues.length) throw new Error(`미리보기 국가 도형이 유효하지 않습니다: ${id} ${JSON.stringify(issues)}`);
    return { ...canonicalFeature, geometry: candidate.geometry };
  });

  const coordinateCount = countCoordinates(features.map(featureValue => featureValue.geometry.coordinates));
  if (coordinateCount > MAX_COORDINATES) throw new Error(`50m 미리보기 좌표 수가 상한을 초과했습니다: ${coordinateCount}`);
  if (supplementedCountryIds.length !== EXPECTED_SUPPLEMENTED_COUNTRY_IDS.size
      || supplementedCountryIds.some(id => !EXPECTED_SUPPLEMENTED_COUNTRY_IDS.has(id))) {
    throw new Error(`50m 보완 국가 목록이 예상과 다릅니다: ${supplementedCountryIds.join(', ')}`);
  }
  const sphericalArea = typeof d3.geoArea === 'function' ? d3.geoArea : d3.geo.area;
  const globalAreaError = Math.abs(sphericalArea({ type: 'FeatureCollection', features }) - sphericalArea(canonicalSource))
    / sphericalArea(canonicalSource);
  return {
    collection: {
      type: 'FeatureCollection',
      features,
      name: `pandolab-world-preview-v${APP_VERSION}`,
      crs: canonicalSource.crs,
      bbox: canonicalSource.bbox,
    },
    coordinateCount,
    supplementedCountryIds,
    globalAreaError,
  };
}

function packMesh(mesh, sourceCoordinateCount) {
  const vertexCount = mesh.positions.length / 2;
  const headerBytes = 8 * Uint32Array.BYTES_PER_ELEMENT;
  const countryBytesPadded = (mesh.countryIndices.byteLength + 3) & ~3;
  const rawByteLength = headerBytes + mesh.positions.byteLength + countryBytesPadded + mesh.triangleIndices.byteLength + mesh.lineIndices.byteLength;
  const raw = Buffer.alloc(rawByteLength);
  const header = new Uint32Array(raw.buffer, raw.byteOffset, 8);
  header.set([0x434d4731, 1, mesh.countryIds.length, vertexCount, mesh.triangleIndices.length, mesh.lineIndices.length, sourceCoordinateCount, meshCore.MESH_ALGORITHM_REVISION]);
  let offset = headerBytes;
  for (const array of [mesh.positions, mesh.countryIndices]) {
    Buffer.from(array.buffer, array.byteOffset, array.byteLength).copy(raw, offset);
    offset += array === mesh.countryIndices ? countryBytesPadded : array.byteLength;
  }
  for (const array of [mesh.triangleIndices, mesh.lineIndices]) {
    Buffer.from(array.buffer, array.byteOffset, array.byteLength).copy(raw, offset);
    offset += array.byteLength;
  }
  if (offset !== raw.length) throw new Error('미리보기 GPU 메시 패킹 길이가 일치하지 않습니다.');
  return { raw, compressed: zlib.gzipSync(raw, { level: 9, mtime: 0 }) };
}

function validatePackedMeshGeometry(mesh) {
  const vertexCount = mesh.positions.length / 2;
  if (!Number.isInteger(vertexCount) || mesh.countryIndices.length !== vertexCount || mesh.countryIds.length !== 258) throw new Error('미리보기 GPU 메시 꼭짓점 또는 국가 메타데이터 길이가 올바르지 않습니다.');
  const coordinateKey = index => `${mesh.positions[index * 2]},${mesh.positions[index * 2 + 1]}`;
  const assertIndex = (index, label) => { if (index >= vertexCount) throw new Error(`${label} 인덱스가 꼭짓점 범위를 벗어났습니다: ${index}`); };
  for (let index = 0; index < mesh.triangleIndices.length; index += 3) {
    const indices = Array.from(mesh.triangleIndices.slice(index, index + 3));
    if (indices.length !== 3) throw new Error('미리보기 삼각형 인덱스 길이가 올바르지 않습니다.');
    indices.forEach(value => assertIndex(value, '미리보기 삼각형'));
    if (new Set(indices.map(coordinateKey)).size < 3) throw new Error(`미리보기 메시의 삼각형 꼭짓점이 겹칩니다: ${index / 3}`);
    if (new Set(indices.map(value => mesh.countryIndices[value])).size !== 1) throw new Error(`미리보기 메시의 삼각형이 서로 다른 국가를 잇습니다: ${index / 3}`);
  }
  for (let index = 0; index < mesh.lineIndices.length; index += 2) {
    const a = mesh.lineIndices[index];
    const b = mesh.lineIndices[index + 1];
    if (b === undefined) throw new Error('미리보기 국경선 인덱스 길이가 올바르지 않습니다.');
    assertIndex(a, '미리보기 국경선');
    assertIndex(b, '미리보기 국경선');
    if (coordinateKey(a) === coordinateKey(b)) throw new Error(`미리보기 메시의 영길이 국경선이 있습니다: ${index / 2}`);
    if (mesh.countryIndices[a] !== mesh.countryIndices[b]) throw new Error(`미리보기 메시의 국경선이 서로 다른 국가를 잇습니다: ${index / 2}`);
  }
}

function compareOrWrite(filePath, bytes) {
  if (checkOnly) {
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    const comparableExisting = existing && path.extname(filePath) === '.json' ? Buffer.from(existing.toString('utf8').replaceAll('\r\n', '\n')) : existing;
    const comparableBytes = path.extname(filePath) === '.json' ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n')) : bytes;
    if (!comparableExisting?.equals(comparableBytes)) throw new Error(`${path.relative(projectRoot, filePath)} 미리보기 자산이 최신 빌드와 다릅니다.`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index];
    if (difference) return difference;
  }
  return 0;
}

function resolvePreviewSeedPath() {
  if (fs.existsSync(previewCountriesPath)) return previewCountriesPath;
  const currentVersion = APP_VERSION.split('.').map(Number);
  const candidates = fs.readdirSync(dataDirectory)
    .map(name => {
      const match = /^countries-preview-v(\d+)\.(\d+)\.(\d+)\.geojson\.gz$/.exec(name);
      return match ? { name, version: match.slice(1).map(Number) } : null;
    })
    .filter(candidate => candidate && compareVersions(candidate.version, currentVersion) < 0)
    .sort((left, right) => compareVersions(left.version, right.version));
  const latest = candidates.at(-1);
  if (!latest) throw new Error('새 미리보기를 생성할 이전 버전 국가 자산이 없습니다.');
  return path.join(dataDirectory, latest.name);
}

const canonicalBytes = Buffer.from(fs.readFileSync(sourcePath, 'utf8').replaceAll('\r\n', '\n'));
const source50Bytes = Buffer.from(fs.readFileSync(previewSourcePath, 'utf8').replaceAll('\r\n', '\n'));
const canonicalMeshBytes = fs.readFileSync(canonicalMeshPath);
const canonicalMeshDecoded = zlib.gunzipSync(canonicalMeshBytes);
const labelAnchorBytes = Buffer.from(fs.readFileSync(labelAnchorsPath, 'utf8').replaceAll('\r\n', '\n'));
const canonicalSource = JSON.parse(canonicalBytes.toString('utf8'));
const source50 = JSON.parse(source50Bytes.toString('utf8'));
const existingPreviewPath = resolvePreviewSeedPath();
const existingPreview = JSON.parse(zlib.gunzipSync(fs.readFileSync(existingPreviewPath)));
if (canonicalSource?.type !== 'FeatureCollection' || canonicalSource.features?.length !== 258) throw new Error('Natural Earth canonical 국가 데이터는 정확히 258개여야 합니다.');
if (source50?.type !== 'FeatureCollection' || !Array.isArray(source50.features)) throw new Error('Natural Earth 50m 국가 데이터가 올바르지 않습니다.');

const startedAt = performance.now();
const preview = buildPreview(canonicalSource, source50, existingPreview);
const previewJson = Buffer.from(JSON.stringify(preview.collection));
const previewCountries = zlib.gzipSync(previewJson, { level: 9, mtime: 0 });
const canonicalCountries = zlib.gzipSync(canonicalBytes, { level: 9, mtime: 0 });
const mesh = meshCore.buildGpuMeshFeatures(preview.collection.features, earcut, { validate: true, maxEdgeDegrees: 2 });
validatePackedMeshGeometry(mesh);
const packedMesh = packMesh(mesh, preview.coordinateCount);
const combinedCompressedBytes = previewCountries.length + packedMesh.compressed.length;
if (combinedCompressedBytes > MAX_COMPRESSED_BYTES) throw new Error(`미리보기 압축 크기가 3MiB를 초과했습니다: ${combinedCompressedBytes}`);

const manifest = {
  version: APP_VERSION,
  source: 'countries-ne-5.1.1-50m.geojson',
  sourceSha256: sha256(source50Bytes),
  previewSourceScale: '50m',
  previewSourceVersion: '5.1.1',
  previewSourceSha256: sha256(source50Bytes),
  canonicalSourceSha256: sha256(canonicalBytes),
  supplementedCountryIds: preview.supplementedCountryIds,
  countries: preview.collection.features.length,
  coordinateCount: preview.coordinateCount,
  globalAreaError: Number(preview.globalAreaError.toFixed(8)),
  meshAlgorithmRevision: meshCore.MESH_ALGORITHM_REVISION,
  meshVertices: mesh.positions.length / 2,
  countriesCompressedBytes: previewCountries.length,
  meshCompressedBytes: packedMesh.compressed.length,
  combinedCompressedBytes,
  countriesSha256: sha256(previewCountries),
  meshSha256: sha256(packedMesh.compressed),
  assets: {
    previewCountries: { url: `countries-preview-v${APP_VERSION}.geojson.gz`, encoding: 'gzip', compressedBytes: previewCountries.length, decodedBytes: previewJson.length, sha256: sha256(previewCountries) },
    previewMesh: { url: `world-mesh-preview-v${APP_VERSION}.bin.gz`, encoding: 'gzip', compressedBytes: packedMesh.compressed.length, decodedBytes: packedMesh.raw.length, sha256: sha256(packedMesh.compressed), header: meshHeader(packedMesh.raw) },
    labelAnchors: { url: 'country-label-anchors-v0.10.1.json', encoding: 'identity', compressedBytes: labelAnchorBytes.length, decodedBytes: labelAnchorBytes.length, sha256: sha256(labelAnchorBytes) },
    canonicalCountries: { url: 'countries-ne-5.1.1.geojson.gz', encoding: 'gzip', compressedBytes: canonicalCountries.length, decodedBytes: canonicalBytes.length, sha256: sha256(canonicalCountries) },
    canonicalMesh: { url: 'world-mesh-v0.12.6.bin.gz', encoding: 'gzip', compressedBytes: canonicalMeshBytes.length, decodedBytes: canonicalMeshDecoded.length, sha256: sha256(canonicalMeshBytes), header: meshHeader(canonicalMeshDecoded) },
  },
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

compareOrWrite(previewCountriesPath, previewCountries);
compareOrWrite(previewMeshPath, packedMesh.compressed);
compareOrWrite(previewManifestPath, manifestBytes);
if (!fs.readFileSync(canonicalCountriesGzipPath).equals(canonicalCountries)) throw new Error('canonical 국가 gzip이 변경되어 있습니다. preview 빌드가 canonical 자산을 덮어쓰지 않았습니다.');

console.log(JSON.stringify({ mode: checkOnly ? 'check' : 'build', ...manifest, milliseconds: Math.round(performance.now() - startedAt) }, null, 2));
