import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { feature as topologyFeature } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, quantile, simplify } from 'topojson-simplify';
import { validateGeometry } from '../assets/js/modules/geometry-validation.js';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, '..');
const APP_VERSION = '0.30.0';
const sourcePath = path.join(projectRoot, 'assets', 'data', 'countries-ne-5.1.1.geojson');
const canonicalCountriesGzipPath = path.join(projectRoot, 'assets', 'data', 'countries-ne-5.1.1.geojson.gz');
const canonicalMeshPath = path.join(projectRoot, 'assets', 'data', 'world-mesh-v0.12.6.bin.gz');
const labelAnchorsPath = path.join(projectRoot, 'assets', 'data', 'country-label-anchors-v0.10.1.json');
const previewCountriesPath = path.join(projectRoot, 'assets', 'data', `countries-preview-v${APP_VERSION}.geojson.gz`);
const previewMeshPath = path.join(projectRoot, 'assets', 'data', `world-mesh-preview-v${APP_VERSION}.bin.gz`);
const previewManifestPath = path.join(projectRoot, 'assets', 'data', `world-preview-v${APP_VERSION}.json`);
const checkOnly = process.argv.includes('--check');

const MAX_COORDINATES = 60_000;
const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_GLOBAL_AREA_ERROR = 0.005;
const QUANTIZATION = 0;

function loadClassicScript(relativePath, globalName) {
  const filePath = path.join(projectRoot, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, 'utf8'), { filename: filePath });
  const value = globalThis[globalName];
  if (!value) throw new Error(`${relativePath}에서 ${globalName}을 불러오지 못했습니다.`);
  return value;
}

const d3 = loadClassicScript(path.join('assets', 'js', 'vendor', 'd3.min.js'), 'd3');
const earcut = loadClassicScript(path.join('assets', 'js', 'vendor', 'earcut.min.js'), 'earcut');
const polygonClipping = loadClassicScript(path.join('assets', 'js', 'vendor', 'polygon-clipping.min.js'), 'polygonClipping');
const countryGeometry = loadClassicScript(path.join('assets', 'js', 'modules', 'country-geometry.js'), 'PandoLabCountryGeometry');
const meshCore = loadClassicScript(path.join('assets', 'js', 'workers', 'gpu-mesh-core.js'), 'PandoLabGpuMeshCore');
const sphericalArea = value => (typeof d3.geoArea === 'function' ? d3.geoArea(value) : d3.geo.area(value));
const MAX_PRESERVATION_ATTEMPTS = 3;

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

function minimalFeature(featureValue, index) {
  const properties = featureValue.properties || {};
  const id = String(featureValue.id || index);
  return {
    type: 'Feature',
    id,
    properties: { name: properties.name || '이름 없는 국가' },
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

function polygonCoordinatesAsMultiPolygon(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function geometryBounds(geometry) {
  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;
  const visit = value => {
    if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      minimumX = Math.min(minimumX, value[0]);
      minimumY = Math.min(minimumY, value[1]);
      maximumX = Math.max(maximumX, value[0]);
      maximumY = Math.max(maximumY, value[1]);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry?.coordinates);
  return [minimumX, minimumY, maximumX, maximumY];
}

function ringArea(ring) {
  let sum = 0;
  for (let index = 0; index < (ring?.length || 0) - 1; index += 1) {
    sum += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return sum / 2;
}

function hasPolygonArea(multiPolygon) {
  return (multiPolygon || []).some(polygon => polygon.some(ring => Math.abs(ringArea(ring)) > 1e-14));
}

function overlappingFeaturePairs(collection) {
  const entries = collection.features.map((featureValue, index) => ({
    index,
    id: String(featureValue.id || index),
    geometry: featureValue.geometry,
    bounds: geometryBounds(featureValue.geometry),
  })).sort((left, right) => left.bounds[0] - right.bounds[0]);
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const left = entries[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const right = entries[rightIndex];
      if (right.bounds[0] > left.bounds[2]) break;
      if (right.bounds[1] > left.bounds[3] || right.bounds[3] < left.bounds[1]) continue;
      const intersection = polygonClipping.intersection(
        polygonCoordinatesAsMultiPolygon(left.geometry),
        polygonCoordinatesAsMultiPolygon(right.geometry),
      );
      if (hasPolygonArea(intersection)) overlaps.push({ left, right });
    }
  }
  return overlaps;
}

function normalizeAndRepairPreviewGeometry(value) {
  const normalized = countryGeometry.normalizeCountryGeometry(value);
  if (!normalized) return null;
  try {
    const multiPolygon = normalized.type === 'Polygon' ? [normalized.coordinates] : normalized.coordinates;
    const repaired = polygonClipping.union(multiPolygon);
    return countryGeometry.normalizeCountryGeometry(repaired);
  } catch (_) {
    return null;
  }
}

function referencedArcIds(geometry) {
  const arcIds = new Set();
  const visit = value => {
    if (Number.isInteger(value)) {
      arcIds.add(value < 0 ? ~value : value);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry.arcs);
  return arcIds;
}

function preserveFeatureArcs(prepared, featureIndex) {
  const geometry = prepared.objects?.countries?.geometries?.[featureIndex];
  if (!geometry) return 0;
  const arcIds = referencedArcIds(geometry);
  let changed = 0;
  for (const arcId of arcIds) {
    for (const point of prepared.arcs[arcId] || []) {
      if (Number.isFinite(point[2])) {
        point[2] = Infinity;
        changed += 1;
      }
    }
  }
  return changed;
}

function materializePreviewCandidate(prepared, originalFeatures, originalIds, percentile) {
  const working = structuredClone(prepared);
  const preservedIds = new Set();
  const canonicalFallbackIds = new Set();
  const arcUsage = new Map();
  for (const geometry of working.objects?.countries?.geometries || []) {
    for (const arcId of referencedArcIds(geometry)) arcUsage.set(arcId, (arcUsage.get(arcId) || 0) + 1);
  }
  for (let attempt = 0; attempt <= MAX_PRESERVATION_ATTEMPTS; attempt += 1) {
    const threshold = quantile(working, Math.min(0.999999, percentile));
    const candidateTopology = simplify(structuredClone(working), threshold);
    const candidate = topologyFeature(candidateTopology, candidateTopology.objects.countries);
    const invalidByIndex = new Map();
    candidate.features = candidate.features.map((featureValue, index) => {
      const geometry = normalizeAndRepairPreviewGeometry(featureValue.geometry);
      if (!geometry) {
        invalidByIndex.set(index, { index, id: originalIds[index], kinds: ['empty-geometry'] });
        return featureValue;
      }
      const normalized = { ...featureValue, geometry };
      const issues = canonicalFeatureIssues(normalized);
      if (issues.length) invalidByIndex.set(index, { index, id: originalIds[index], kinds: [...new Set(issues.map(issue => issue.kind))] });
      return normalized;
    });
    for (const pair of overlappingFeaturePairs(candidate)) {
      for (const [entry, neighbor] of [[pair.left, pair.right], [pair.right, pair.left]]) {
        const item = invalidByIndex.get(entry.index) || { index: entry.index, id: entry.id, kinds: [] };
        item.kinds.push(`country-overlap:${neighbor.id}`);
        item.kinds = [...new Set(item.kinds)];
        invalidByIndex.set(entry.index, item);
      }
    }
    const invalid = [...invalidByIndex.values()];
    if (!invalid.length) return { collection: candidate, preservedIds: [...preservedIds], canonicalFallbackIds: [...canonicalFallbackIds] };
    let changed = 0;
    for (const item of invalid) {
      preservedIds.add(item.id);
      changed += preserveFeatureArcs(working, item.index);
    }
    if (changed && attempt < MAX_PRESERVATION_ATTEMPTS) continue;

    const unresolved = [];
    for (const item of invalid) {
      const topologyGeometry = working.objects?.countries?.geometries?.[item.index];
      const isolated = topologyGeometry && [...referencedArcIds(topologyGeometry)].every(arcId => arcUsage.get(arcId) === 1);
      const geometry = isolated ? normalizeAndRepairPreviewGeometry(originalFeatures[item.index]?.geometry) : null;
      const replacement = geometry ? { ...candidate.features[item.index], geometry } : null;
      const issues = replacement ? canonicalFeatureIssues(replacement) : [{ kind: 'shared-or-invalid-canonical-fallback' }];
      if (replacement && !issues.length) {
        candidate.features[item.index] = replacement;
        canonicalFallbackIds.add(item.id);
      } else {
        unresolved.push(item);
      }
    }
    if (!unresolved.length) {
      return { collection: candidate, preservedIds: [...preservedIds], canonicalFallbackIds: [...canonicalFallbackIds] };
    }
    throw new Error(`미리보기 국가 도형을 ${MAX_PRESERVATION_ATTEMPTS}회 보존 재시도 후에도 복구하지 못했습니다: ${JSON.stringify(unresolved)}`);
  }
  throw new Error('미리보기 국가 도형 보존 반복이 비정상적으로 종료되었습니다.');
}

function packMesh(mesh, sourceCoordinateCount) {
  const vertexCount = mesh.positions.length / 2;
  const headerBytes = 8 * Uint32Array.BYTES_PER_ELEMENT;
  const countryBytesPadded = (mesh.countryIndices.byteLength + 3) & ~3;
  const rawByteLength = headerBytes + mesh.positions.byteLength + countryBytesPadded
    + mesh.triangleIndices.byteLength + mesh.lineIndices.byteLength;
  const raw = Buffer.alloc(rawByteLength);
  const header = new Uint32Array(raw.buffer, raw.byteOffset, 8);
  header.set([
    0x434d4731,
    1,
    mesh.countryIds.length,
    vertexCount,
    mesh.triangleIndices.length,
    mesh.lineIndices.length,
    sourceCoordinateCount,
    meshCore.MESH_ALGORITHM_REVISION,
  ]);
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
  if (!Number.isInteger(vertexCount) || mesh.countryIndices.length !== vertexCount || mesh.countryIds.length !== 258) {
    throw new Error('미리보기 GPU 메시 꼭짓점 또는 국가 메타데이터 길이가 올바르지 않습니다.');
  }
  const coordinateKey = index => `${mesh.positions[index * 2]},${mesh.positions[index * 2 + 1]}`;
  const vector = index => {
    const longitude = mesh.positions[index * 2] * 1e-6 * Math.PI / 180;
    const latitude = mesh.positions[index * 2 + 1] * 1e-6 * Math.PI / 180;
    const cosine = Math.cos(latitude);
    return [cosine * Math.cos(longitude), cosine * Math.sin(longitude), Math.sin(latitude)];
  };
  const vectors = Array.from({ length: vertexCount }, (_, index) => vector(index));
  const assertIndex = (index, label) => {
    if (index >= vertexCount) throw new Error(`${label} 인덱스가 꼭짓점 범위를 벗어났습니다: ${index}`);
  };
  for (let index = 0; index < mesh.triangleIndices.length; index += 3) {
    const indices = Array.from(mesh.triangleIndices.slice(index, index + 3));
    if (indices.length !== 3) throw new Error('미리보기 삼각형 인덱스 길이가 올바르지 않습니다.');
    indices.forEach(value => assertIndex(value, '미리보기 삼각형'));
    if (new Set(indices.map(coordinateKey)).size < 3) throw new Error(`미리보기 메시의 삼각형 꼭짓점이 겹칩니다: ${index / 3}`);
    const [a, b, c] = indices.map(value => vectors[value]);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2 <= 1e-32) {
      throw new Error(`미리보기 메시의 영면적 삼각형이 있습니다: ${index / 3}`);
    }
    if (new Set(indices.map(value => mesh.countryIndices[value])).size !== 1) {
      throw new Error(`미리보기 메시의 삼각형이 서로 다른 국가를 잇습니다: ${index / 3}`);
    }
  }
  for (let index = 0; index < mesh.lineIndices.length; index += 2) {
    const a = mesh.lineIndices[index];
    const b = mesh.lineIndices[index + 1];
    if (b === undefined) throw new Error('미리보기 국경선 인덱스 길이가 올바르지 않습니다.');
    assertIndex(a, '미리보기 국경선');
    assertIndex(b, '미리보기 국경선');
    if (coordinateKey(a) === coordinateKey(b)) throw new Error(`미리보기 메시의 영길이 국경선이 있습니다: ${index / 2}`);
    if (mesh.countryIndices[a] !== mesh.countryIndices[b]) {
      throw new Error(`미리보기 메시의 국경선이 서로 다른 국가를 잇습니다: ${index / 2}`);
    }
  }
}

function buildPreview(source) {
  const minimal = {
    type: 'FeatureCollection',
    name: `pandolab-world-preview-v${APP_VERSION}`,
    features: source.features.map(minimalFeature),
  };
  const originalIds = minimal.features.map(featureValue => featureValue.id);
  if (new Set(originalIds).size !== 258) throw new Error('원본 국가 ID가 정확히 258개여야 합니다.');
  const canonicalErrors = minimal.features.flatMap((featureValue, index) => {
    const issues = canonicalFeatureIssues(featureValue);
    return issues.length ? [{ id: originalIds[index], kinds: [...new Set(issues.map(issue => issue.kind))] }] : [];
  });
  if (canonicalErrors.length) {
    throw new Error(`canonical 국가 원본에 구조 오류가 있습니다: ${JSON.stringify(canonicalErrors)}`);
  }
  const prepared = presimplify(topology({ countries: minimal }));
  const originalArea = sphericalArea(minimal);
  let selected = null;
  const diagnostics = [];
  for (const percentile of [0.022, 0.025, 0.03, 0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2]) {
    const materialized = materializePreviewCandidate(prepared, minimal.features, originalIds, percentile);
    const candidate = materialized.collection;
    const coordinateCount = countCoordinates(candidate.features.map(featureValue => featureValue.geometry?.coordinates));
    const areaError = Math.abs(sphericalArea(candidate) - originalArea) / originalArea;
    const ids = candidate.features.map(featureValue => String(featureValue.id || ''));
    const invalidGeometryCount = candidate.features.filter(featureValue => canonicalFeatureIssues(featureValue).length).length;
    const geometriesValid = invalidGeometryCount === 0;
    diagnostics.push({
      percentile,
      coordinateCount,
      areaError,
      geometriesValid,
      preservedCountries: materialized.preservedIds.length,
      canonicalFallbackCountries: materialized.canonicalFallbackIds.length,
    });
    if (coordinateCount <= MAX_COORDINATES && areaError <= MAX_GLOBAL_AREA_ERROR
        && geometriesValid && ids.length === 258 && ids.every((id, index) => id === originalIds[index])) {
      selected = {
        collection: candidate,
        coordinateCount,
        areaError,
        percentile,
        preservedCountries: materialized.preservedIds.length,
        canonicalFallbackCountries: materialized.canonicalFallbackIds.length,
      };
      break;
    }
  }
  if (!selected) throw new Error(`미리보기 좌표·면적 예산을 만족하는 TopoJSON 단순화 결과를 만들지 못했습니다. ${JSON.stringify(diagnostics)}`);
  selected.collection.name = minimal.name;
  selected.collection.crs = source.crs;
  selected.collection.bbox = source.bbox;
  return selected;
}

function compareOrWrite(filePath, bytes) {
  if (checkOnly) {
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    const comparableExisting = existing && path.extname(filePath) === '.json'
      ? Buffer.from(existing.toString('utf8').replaceAll('\r\n', '\n'))
      : existing;
    const comparableBytes = path.extname(filePath) === '.json'
      ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
      : bytes;
    if (!comparableExisting?.equals(comparableBytes)) {
      throw new Error(`${path.relative(projectRoot, filePath)} 미리보기 자산이 최신 빌드와 다릅니다.`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

const sourceBytes = Buffer.from(fs.readFileSync(sourcePath, 'utf8').replaceAll('\r\n', '\n'));
const canonicalMeshBytes = fs.readFileSync(canonicalMeshPath);
const canonicalMeshDecoded = zlib.gunzipSync(canonicalMeshBytes);
const labelAnchorBytes = Buffer.from(fs.readFileSync(labelAnchorsPath, 'utf8').replaceAll('\r\n', '\n'));
const source = JSON.parse(sourceBytes.toString('utf8'));
if (source?.type !== 'FeatureCollection' || source.features?.length !== 258) {
  throw new Error('Natural Earth 국가 데이터는 정확히 258개여야 합니다.');
}

const startedAt = performance.now();
const preview = buildPreview(source);
const previewJson = Buffer.from(JSON.stringify(preview.collection));
const previewCountries = zlib.gzipSync(previewJson, { level: 9, mtime: 0 });
const canonicalCountries = zlib.gzipSync(sourceBytes, { level: 9, mtime: 0 });
const mesh = meshCore.buildGpuMeshFeatures(preview.collection.features, earcut, { validate: true, maxEdgeDegrees: 2 });
validatePackedMeshGeometry(mesh);
const packedMesh = packMesh(mesh, preview.coordinateCount);
const combinedCompressedBytes = previewCountries.length + packedMesh.compressed.length;
if (combinedCompressedBytes > MAX_COMPRESSED_BYTES) {
  throw new Error(`미리보기 압축 크기가 2MB를 초과했습니다: ${combinedCompressedBytes}`);
}

const manifest = {
  version: APP_VERSION,
  source: 'countries-ne-5.1.1.geojson',
  sourceSha256: sha256(sourceBytes),
  countries: preview.collection.features.length,
  coordinateCount: preview.coordinateCount,
  globalAreaError: Number(preview.areaError.toFixed(8)),
  simplificationPercentile: Number(preview.percentile.toFixed(3)),
  quantization: QUANTIZATION,
  meshAlgorithmRevision: meshCore.MESH_ALGORITHM_REVISION,
  meshVertices: mesh.positions.length / 2,
  countriesCompressedBytes: previewCountries.length,
  meshCompressedBytes: packedMesh.compressed.length,
  combinedCompressedBytes,
  countriesSha256: sha256(previewCountries),
  meshSha256: sha256(packedMesh.compressed),
  assets: {
    previewCountries: {
      url: `countries-preview-v${APP_VERSION}.geojson.gz`,
      encoding: 'gzip',
      compressedBytes: previewCountries.length,
      decodedBytes: previewJson.length,
      sha256: sha256(previewCountries),
    },
    previewMesh: {
      url: `world-mesh-preview-v${APP_VERSION}.bin.gz`,
      encoding: 'gzip',
      compressedBytes: packedMesh.compressed.length,
      decodedBytes: packedMesh.raw.length,
      sha256: sha256(packedMesh.compressed),
      header: meshHeader(packedMesh.raw),
    },
    labelAnchors: {
      url: 'country-label-anchors-v0.10.1.json',
      encoding: 'identity',
      compressedBytes: labelAnchorBytes.length,
      decodedBytes: labelAnchorBytes.length,
      sha256: sha256(labelAnchorBytes),
    },
    canonicalCountries: {
      url: 'countries-ne-5.1.1.geojson.gz',
      encoding: 'gzip',
      compressedBytes: canonicalCountries.length,
      decodedBytes: sourceBytes.length,
      sha256: sha256(canonicalCountries),
    },
    canonicalMesh: {
      url: 'world-mesh-v0.12.6.bin.gz',
      encoding: 'gzip',
      compressedBytes: canonicalMeshBytes.length,
      decodedBytes: canonicalMeshDecoded.length,
      sha256: sha256(canonicalMeshBytes),
      header: meshHeader(canonicalMeshDecoded),
    },
  },
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

compareOrWrite(previewCountriesPath, previewCountries);
compareOrWrite(previewMeshPath, packedMesh.compressed);
compareOrWrite(canonicalCountriesGzipPath, canonicalCountries);
compareOrWrite(previewManifestPath, manifestBytes);

console.log(JSON.stringify({
  mode: checkOnly ? 'check' : 'build',
  ...manifest,
  milliseconds: Math.round(performance.now() - startedAt),
}, null, 2));
