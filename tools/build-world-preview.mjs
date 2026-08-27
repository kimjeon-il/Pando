import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { feature as topologyFeature } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, quantile, simplify } from 'topojson-simplify';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, '..');
const sourcePath = path.join(projectRoot, 'assets', 'data', 'countries-ne-5.1.1.geojson');
const previewCountriesPath = path.join(projectRoot, 'assets', 'data', 'countries-preview-v0.29.0.geojson.gz');
const previewMeshPath = path.join(projectRoot, 'assets', 'data', 'world-mesh-preview-v0.29.0.bin.gz');
const previewManifestPath = path.join(projectRoot, 'assets', 'data', 'world-preview-v0.29.0.json');
const checkOnly = process.argv.includes('--check');

const MAX_COORDINATES = 60_000;
const MAX_COMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_GLOBAL_AREA_ERROR = 0.005;
const QUANTIZATION = 1_000_000;

function loadClassicScript(relativePath, globalName) {
  const filePath = path.join(projectRoot, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, 'utf8'), { filename: filePath });
  const value = globalThis[globalName];
  if (!value) throw new Error(`${relativePath}에서 ${globalName}을 불러오지 못했습니다.`);
  return value;
}

const d3 = loadClassicScript(path.join('assets', 'js', 'vendor', 'd3.min.js'), 'd3');
const earcut = loadClassicScript(path.join('assets', 'js', 'vendor', 'earcut.min.js'), 'earcut');
const meshCore = loadClassicScript(path.join('assets', 'js', 'workers', 'gpu-mesh-core.js'), 'PandoLabGpuMeshCore');
const sphericalArea = value => (typeof d3.geoArea === 'function' ? d3.geoArea(value) : d3.geo.area(value));

function countCoordinates(value) {
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return 1;
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => sum + countCoordinates(item), 0);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function minimalFeature(featureValue, index) {
  const properties = featureValue.properties || {};
  const id = String(properties.editor_id || properties.iso_a3 || index);
  return {
    type: 'Feature',
    properties: {
      name: properties.name || properties.ADMIN || properties.NAME || '이름 없는 국가',
      iso_a3: properties.iso_a3 || properties.ISO_A3 || properties.ADM0_A3 || id,
      continent: properties.continent || '',
      pop_est: Number(properties.pop_est || 0),
      editor_id: id,
    },
    geometry: featureValue.geometry,
  };
}

function validGeometry(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!polygons.length) return false;
  return polygons.every(polygon => Array.isArray(polygon)
    && polygon.length
    && polygon.every(ring => Array.isArray(ring)
      && ring.length >= 4
      && ring.every(point => Array.isArray(point)
        && point.length >= 2
        && Number.isFinite(point[0])
        && Number.isFinite(point[1])
        && point[0] >= -180 && point[0] <= 180
        && point[1] >= -90 && point[1] <= 90)));
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

function buildPreview(source) {
  const minimal = {
    type: 'FeatureCollection',
    name: 'pandolab-world-preview-v0.29.0',
    features: source.features.map(minimalFeature),
  };
  const originalIds = minimal.features.map(featureValue => featureValue.properties.editor_id);
  if (new Set(originalIds).size !== 258) throw new Error('원본 국가 ID가 정확히 258개여야 합니다.');
  const prepared = presimplify(topology({ countries: minimal }, QUANTIZATION));
  const originalArea = sphericalArea(minimal);
  let selected = null;
  const diagnostics = [];
  for (const percentile of [0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.2]) {
    const candidateTopology = simplify(structuredClone(prepared), quantile(prepared, Math.min(0.999999, percentile)));
    const candidate = topologyFeature(candidateTopology, candidateTopology.objects.countries);
    let invalidGeometryCount = 0;
    candidate.features = candidate.features.map((featureValue, index) => {
      if (validGeometry(featureValue.geometry)) return featureValue;
      invalidGeometryCount += 1;
      return structuredClone(minimal.features[index]);
    });
    const coordinateCount = countCoordinates(candidate.features.map(featureValue => featureValue.geometry?.coordinates));
    const areaError = Math.abs(sphericalArea(candidate) - originalArea) / originalArea;
    const ids = candidate.features.map(featureValue => String(featureValue.properties?.editor_id || ''));
    const geometriesValid = invalidGeometryCount === 0
      && candidate.features.every(featureValue => validGeometry(featureValue.geometry));
    diagnostics.push({ percentile, coordinateCount, areaError, geometriesValid });
    if (coordinateCount <= MAX_COORDINATES && areaError <= MAX_GLOBAL_AREA_ERROR
        && geometriesValid && ids.length === 258 && ids.every((id, index) => id === originalIds[index])) {
      selected = { collection: candidate, coordinateCount, areaError, percentile };
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
    if (!fs.existsSync(filePath) || !fs.readFileSync(filePath).equals(bytes)) {
      throw new Error(`${path.relative(projectRoot, filePath)} 미리보기 자산이 최신 빌드와 다릅니다.`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

const sourceBytes = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBytes.toString('utf8'));
if (source?.type !== 'FeatureCollection' || source.features?.length !== 258) {
  throw new Error('Natural Earth 국가 데이터는 정확히 258개여야 합니다.');
}

const startedAt = performance.now();
const preview = buildPreview(source);
const previewJson = Buffer.from(JSON.stringify(preview.collection));
const previewCountries = zlib.gzipSync(previewJson, { level: 9, mtime: 0 });
const mesh = meshCore.buildGpuMeshFeatures(preview.collection.features, earcut, { validate: true, maxEdgeDegrees: 2 });
const packedMesh = packMesh(mesh, preview.coordinateCount);
const combinedCompressedBytes = previewCountries.length + packedMesh.compressed.length;
if (combinedCompressedBytes > MAX_COMPRESSED_BYTES) {
  throw new Error(`미리보기 압축 크기가 2MB를 초과했습니다: ${combinedCompressedBytes}`);
}

const manifest = {
  version: '0.29.0',
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
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

compareOrWrite(previewCountriesPath, previewCountries);
compareOrWrite(previewMeshPath, packedMesh.compressed);
compareOrWrite(previewManifestPath, manifestBytes);

console.log(JSON.stringify({
  mode: checkOnly ? 'check' : 'build',
  ...manifest,
  milliseconds: Math.round(performance.now() - startedAt),
}, null, 2));
