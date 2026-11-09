import {writeLibraryOutput} from "../data/library-runtime.mjs";
import { buildFrontendIndex, frontendAsset } from "../../scripts/lib/frontend-layout.mjs";
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readProjectWorldGenerationContext } from './project-generation-context.mjs';

import { validateClippedGeometry as validateGeometry } from "../../src/geometry/geometry-validation.js";
import { inspectCanonicalCountryPacket } from "../../src/rendering/canonical-country-packet.js";
import { encodeCanonicalCountryPacket } from "./canonical-country-packet-encoder.mjs";
import { buildTopologyPreview } from "../gis/preview-topology.mjs";
import { classifyBuiltinCountries } from "../gis/builtin-country-classification.mjs";
import { loadBuiltinDisplayPolicy } from "../gis/builtin-display-policy.mjs";
import { geometryFingerprint } from "../../src/document/project-preview-policy.js";
import { verifyGzipAssetBytes } from "../../scripts/lib/gzip-asset-verification.mjs";
import "./load-spherical-core.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, '..', '..');
const projectId = process.argv.find(value=>value.startsWith('--project='))?.slice('--project='.length) || 'default-world';
const context = readProjectWorldGenerationContext({root:projectRoot,projectId});
const bundleSeed = context.worldRecipe;
const legacyTag = /(?:^|\/)(?:world-)?preview-v(\d+\.\d+\.\d+)\.json$/.exec(bundleSeed.legacyPreviewManifest || '');
if (!legacyTag) throw new Error('Invalid pinned world dataset output revision');
const LEGACY_DATA_VERSION = legacyTag[1];
const dataDirectory = path.join(projectRoot, 'assets', 'data');
const legacySourceManifest = JSON.parse(fs.readFileSync(path.join(dataDirectory, bundleSeed.legacyPreviewManifest), 'utf8'));
if (legacySourceManifest.version !== LEGACY_DATA_VERSION) throw new Error('Inconsistent pinned legacy world data revision');
const sourcePath = path.resolve(projectRoot,context.source('territorialCurrentWorld'));
const canonicalCountryPacketPath = path.join(dataDirectory, legacySourceManifest.assets.canonicalCountryPacket.url);
const canonicalMeshPath = path.join(dataDirectory, legacySourceManifest.assets.canonicalMesh.url);
const labelAnchorsPath = path.join(dataDirectory, legacySourceManifest.assets.labelAnchors.url);
const previewCountriesPath = path.join(dataDirectory, legacySourceManifest.assets.previewCountries.url);
const previewMeshPath = path.join(dataDirectory, legacySourceManifest.assets.previewMesh.url);
const previewManifestPath = path.join(dataDirectory, bundleSeed.legacyPreviewManifest);
if(projectId!=='default-world'&&Object.values(legacySourceManifest.assets)
  .some(asset=>typeof asset?.url!=='string'
    ||!/^[-a-zA-Z0-9_./]+$/.test(asset.url)
    ||asset.url.split('/').some(part=>!part||part==='.'||part==='..')
    ||!asset.url.startsWith(projectId+'/')))
  throw new TypeError('Nondefault project world assets must use a project-owned immutable output namespace');
const checkOnly = process.argv.includes('--check');

const MAX_COORDINATES = 120_000;
const MAX_COMPRESSED_BYTES = 3 * 1024 * 1024;
const frontend = buildFrontendIndex(projectRoot);

function loadClassicScript(relativePath, globalName) {
  const asset = frontendAsset(projectRoot, relativePath.replaceAll('\\', '/'), { index: frontend });
  vm.runInThisContext(asset.bytes.toString('utf8'), { filename: asset.sourcePath });
  const value = globalThis[globalName];
  if (!value) throw new Error(`${relativePath}에서 ${globalName}을 불러오지 못했습니다.`);
  return value;
}

const d3 = loadClassicScript(path.join('assets', 'js', 'vendor', 'd3.min.js'), 'd3');
const countryGeometry = loadClassicScript(path.join('assets', 'js', 'modules', 'polygon-geometry.js'), 'PandoLabPolygonGeometry');
const meshCore = loadClassicScript(path.join('assets', 'js', 'workers', 'gpu-mesh-core.js'), 'PandoLabGpuMeshCore');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function meshHeader(value) {
  const prefix = new Uint32Array(value.buffer, value.byteOffset, 8);
  const words = prefix[1] >= 2 ? 12 : 8;
  return Array.from(new Uint32Array(value.buffer, value.byteOffset, words));
}

function countryId(value, fallback = '') {
  const id = value?.id ?? value?.properties?.editor_id ?? value?.properties?.iso_a3 ?? fallback;
  return String(id || '').trim();
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
  if (!countryGeometry.hasCanonicalClippedPolygonWinding(featureValue?.geometry)) {
    issues.push({ kind: 'noncanonical-winding', message: '국가 고리 방향 또는 구조가 canonical 규격과 다릅니다.' });
  }
  return issues;
}

function buildPreview(canonicalSource) {
  const canonicalFeatures = canonicalSource.features.map(minimalFeature);
  const canonicalIds = canonicalFeatures.map(featureValue => featureValue.id);
  if (!canonicalFeatures.length || new Set(canonicalIds).size !== canonicalFeatures.length) throw new Error('canonical 국가 목록은 비어 있거나 중복되었습니다.');
  const { features, coordinateCount, simplificationQuantile } = buildTopologyPreview(canonicalFeatures, {
    maxCoordinates: MAX_COORDINATES,
    normalizeGeometry: countryGeometry.normalizeClippedPolygonGeometry,
    validateGeometry,
    hasCanonicalWinding: countryGeometry.hasCanonicalClippedPolygonWinding,
  });
  for (const featureValue of features) {
    const issues = canonicalFeatureIssues(featureValue);
    if (issues.length) throw new Error(`미리보기 국가 도형이 유효하지 않습니다: ${featureValue.id} ${JSON.stringify(issues)}`);
  }
  const sphericalArea = typeof d3.geoArea === 'function' ? d3.geoArea : d3.geo.area;
  const globalAreaError = Math.abs(sphericalArea({ type: 'FeatureCollection', features }) - sphericalArea(canonicalSource))
    / sphericalArea(canonicalSource);
  return {
    collection: {
      type: 'FeatureCollection',
      features,
      name: `pandolab-world-preview-v${LEGACY_DATA_VERSION}`,
      crs: canonicalSource.crs,
      bbox: canonicalSource.bbox,
    },
    coordinateCount,
    simplificationQuantile,
    globalAreaError,
  };
}

function packMesh(mesh, sourceCoordinateCount) {
  const vertexCount = mesh.positions.length / 2;
  const headerWords = 12;
  const headerBytes = headerWords * Uint32Array.BYTES_PER_ELEMENT;
  const countryBytesPadded = (mesh.countryIndices.byteLength + 3) & ~3;
  const rawByteLength = headerBytes + mesh.positions.byteLength + countryBytesPadded
    + mesh.triangleIndices.byteLength + mesh.lineIndices.byteLength
    + mesh.countryTriangleRanges.byteLength + mesh.countryBoundaryRanges.byteLength
    + mesh.countryBounds.byteLength + mesh.countryBoundsFlags.byteLength;
  const raw = Buffer.alloc(rawByteLength);
  const header = new Uint32Array(raw.buffer, raw.byteOffset, headerWords);
  header.set([
    0x434d4731, 2, mesh.countryIds.length, vertexCount,
    mesh.triangleIndices.length, mesh.lineIndices.length,
    sourceCoordinateCount, meshCore.MESH_ALGORITHM_REVISION,
    mesh.countryTriangleRanges.length, mesh.countryBoundaryRanges.length,
    mesh.countryBounds.length, mesh.countryBoundsFlags.length,
  ]);
  let offset = headerBytes;
  for (const array of [mesh.positions, mesh.countryIndices]) {
    Buffer.from(array.buffer, array.byteOffset, array.byteLength).copy(raw, offset);
    offset += array === mesh.countryIndices ? countryBytesPadded : array.byteLength;
  }
  for (const array of [
    mesh.triangleIndices,
    mesh.lineIndices,
    mesh.countryTriangleRanges,
    mesh.countryBoundaryRanges,
    mesh.countryBounds,
    mesh.countryBoundsFlags,
  ]) {
    Buffer.from(array.buffer, array.byteOffset, array.byteLength).copy(raw, offset);
    offset += array.byteLength;
  }
  if (offset !== raw.length) throw new Error('미리보기 GPU 메시 패킹 길이가 일치하지 않습니다.');
  return { raw, compressed: zlib.gzipSync(raw, { level: 9, mtime: 0 }) };
}

function validatePackedMeshGeometry(mesh, expectedCountries) {
  const vertexCount = mesh.positions.length / 2;
  if (!Number.isInteger(vertexCount) || mesh.countryIndices.length !== vertexCount || mesh.countryIds.length !== expectedCountries) throw new Error('미리보기 GPU 메시 꼭짓점 또는 국가 메타데이터 길이가 올바르지 않습니다.');
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
  writeLibraryOutput(filePath, bytes);
}

function checkedGzip(filePath, generated) {
  if (!checkOnly) return generated;
  return verifyGzipAssetBytes(fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
    generated, path.relative(projectRoot, filePath));
}

const canonicalBytes = Buffer.from(fs.readFileSync(sourcePath, 'utf8').replaceAll('\r\n', '\n'));
const canonicalMeshBytes = fs.readFileSync(canonicalMeshPath);
const canonicalMeshDecoded = zlib.gunzipSync(canonicalMeshBytes);
const labelAnchorBytes = Buffer.from(fs.readFileSync(labelAnchorsPath, 'utf8').replaceAll('\r\n', '\n'));
const canonicalSource = JSON.parse(canonicalBytes.toString('utf8'));
if (canonicalSource?.type !== 'FeatureCollection' || !canonicalSource.features?.length) throw new Error('현재 세계지도 국가 데이터가 비어 있거나 올바르지 않습니다.');

const startedAt = performance.now();
const preview = buildPreview(canonicalSource);
const classified = classifyBuiltinCountries({ ...canonicalSource, features: canonicalSource.features.map(minimalFeature) }, { displayPolicy: loadBuiltinDisplayPolicy(context.source('displayPolicy')) });
const canonicalById = new Map(canonicalSource.features.map((feature, index) => [countryId(feature, String(index)), feature]));
const classifiedById = new Map(classified.countries.features.map(feature => [String(feature.id), feature]));
const defaultClassification = {
  countries: Object.fromEntries(classified.countries.features.map(feature => [String(feature.id), geometryFingerprint(feature.geometry)])),
  changed: Object.fromEntries(classified.countries.features
    .filter(feature => geometryFingerprint(feature.geometry) !== geometryFingerprint(canonicalById.get(String(feature.id))?.geometry))
    .map(feature => [String(feature.id), geometryFingerprint(feature.geometry)])),
  removedIds: [...canonicalById.keys()].filter(id => !classifiedById.has(id)),
  units: Object.fromEntries(classified.subunits.map(unit => [String(unit.id), {
    parentId: String(unit.properties.parentId), geometry: geometryFingerprint(unit.geometry),
    revision: unit.properties.metadata.builtinSubunit.revision,
  }])),
};
const previewJson = Buffer.from(JSON.stringify(preview.collection));
const previewCountries = checkedGzip(previewCountriesPath, zlib.gzipSync(previewJson, { level: 9, mtime: 0 }));
const canonicalCountryPacketBuffer = encodeCanonicalCountryPacket(canonicalSource);
const canonicalCountryPacketHeader = inspectCanonicalCountryPacket(canonicalCountryPacketBuffer);
const canonicalCountryPacket = checkedGzip(canonicalCountryPacketPath, zlib.gzipSync(Buffer.from(canonicalCountryPacketBuffer), { level: 9, mtime: 0 }));
// LSIB detail increases source vertices; these are data budgets, not wire limits.
if (canonicalCountryPacketBuffer.byteLength > 24 * 1024 * 1024) throw new Error(`canonical 국가 packet이 24MiB를 초과했습니다: ${canonicalCountryPacketBuffer.byteLength}`);
if (canonicalCountryPacket.length > 13 * 1024 * 1024) throw new Error(`canonical 국가 packet gzip이 13MiB를 초과했습니다: ${canonicalCountryPacket.length}`);
const mesh = meshCore.buildGpuMeshFeatures(preview.collection.features, { validate: true, maxEdgeDegrees: 2 });
validatePackedMeshGeometry(mesh, canonicalSource.features.length);
const packedMesh = packMesh(mesh, preview.coordinateCount);
packedMesh.compressed = checkedGzip(previewMeshPath, packedMesh.compressed);
const combinedCompressedBytes = previewCountries.length + packedMesh.compressed.length;
if (combinedCompressedBytes > MAX_COMPRESSED_BYTES) throw new Error(`미리보기 압축 크기가 3MiB를 초과했습니다: ${combinedCompressedBytes}`);

const manifest = {
  version: LEGACY_DATA_VERSION,
  source: bundleSeed.canonicalSource,
  sourceSha256: sha256(canonicalBytes),
  defaultClassification,
  previewDerivation: 'canonical-topology-simplified',
  previewSourceScale: 'derived',
  previewSourceSha256: sha256(canonicalBytes),
  canonicalSourceSha256: sha256(canonicalBytes),
  simplificationQuantile: preview.simplificationQuantile,
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
    previewCountries: { url: legacySourceManifest.assets.previewCountries.url, encoding: 'gzip', compressedBytes: previewCountries.length, decodedBytes: previewJson.length, sha256: sha256(previewCountries) },
    previewMesh: { url: legacySourceManifest.assets.previewMesh.url, encoding: 'gzip', compressedBytes: packedMesh.compressed.length, decodedBytes: packedMesh.raw.length, sha256: sha256(packedMesh.compressed), header: meshHeader(packedMesh.raw) },
    labelAnchors: { url: legacySourceManifest.assets.labelAnchors.url, encoding: 'identity', compressedBytes: labelAnchorBytes.length, decodedBytes: labelAnchorBytes.length, sha256: sha256(labelAnchorBytes) },
    canonicalCountryPacket: {
      url: legacySourceManifest.assets.canonicalCountryPacket.url,
      encoding: 'gzip',
      compressedBytes: canonicalCountryPacket.length,
      decodedBytes: canonicalCountryPacketBuffer.byteLength,
      sha256: sha256(canonicalCountryPacket),
      header: canonicalCountryPacketHeader.words,
    },
    canonicalMesh: { url: legacySourceManifest.assets.canonicalMesh.url, encoding: 'gzip', compressedBytes: canonicalMeshBytes.length, decodedBytes: canonicalMeshDecoded.length, sha256: sha256(canonicalMeshBytes), header: meshHeader(canonicalMeshDecoded) },
  },
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

compareOrWrite(previewCountriesPath, previewCountries);
compareOrWrite(previewMeshPath, packedMesh.compressed);
compareOrWrite(canonicalCountryPacketPath, canonicalCountryPacket);
compareOrWrite(previewManifestPath, manifestBytes);

console.log(JSON.stringify({ mode: checkOnly ? 'check' : 'build', ...manifest, milliseconds: Math.round(performance.now() - startedAt) }, null, 2));
