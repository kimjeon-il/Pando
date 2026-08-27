import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, '..');
const sourcePath = path.join(projectRoot, 'assets', 'data', 'countries-ne-5.1.1.geojson');
const outputPath = path.resolve(
  projectRoot,
  process.argv[2] || path.join('assets', 'data', 'world-mesh-v0.12.6.bin.gz'),
);
function loadClassicScript(relativePath, globalName) {
  const filePath = path.join(projectRoot, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, 'utf8'), { filename: filePath });
  const value = globalThis[globalName];
  if (!value) throw new Error(`${relativePath}에서 ${globalName}을 불러오지 못했습니다.`);
  return value;
}

const earcut = loadClassicScript(path.join('assets', 'js', 'vendor', 'earcut.min.js'), 'earcut');
const meshCore = loadClassicScript(path.join('assets', 'js', 'workers', 'gpu-mesh-core.js'), 'PandoLabGpuMeshCore');

function countCoordinates(value) {
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return 1;
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => sum + countCoordinates(item), 0);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validateIndices(indices, vertexCount, stride, label) {
  if (indices.length % stride !== 0) throw new Error(`${label} 인덱스 길이가 올바르지 않습니다.`);
  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index] >= vertexCount) throw new Error(`${label} 인덱스가 꼭짓점 범위를 벗어났습니다: ${indices[index]}`);
  }
}

function validatePackedGeometry(mesh) {
  const vertexCount = mesh.positions.length / 2;
  const vectors = new Float64Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    const longitude = mesh.positions[index * 2] * 1e-6 * Math.PI / 180;
    const latitude = mesh.positions[index * 2 + 1] * 1e-6 * Math.PI / 180;
    const cosine = Math.cos(latitude);
    vectors[index * 3] = cosine * Math.cos(longitude);
    vectors[index * 3 + 1] = cosine * Math.sin(longitude);
    vectors[index * 3 + 2] = Math.sin(latitude);
  }
  const edgeDegrees = (a, b) => {
    const dot = Math.max(-1, Math.min(1,
      vectors[a * 3] * vectors[b * 3] +
      vectors[a * 3 + 1] * vectors[b * 3 + 1] +
      vectors[a * 3 + 2] * vectors[b * 3 + 2]));
    return Math.acos(dot) * 180 / Math.PI;
  };
  let maximumTriangleEdge = 0;
  const triangleKeys = new Set();
  for (let index = 0; index < mesh.triangleIndices.length; index += 3) {
    const a = mesh.triangleIndices[index];
    const b = mesh.triangleIndices[index + 1];
    const c = mesh.triangleIndices[index + 2];
    if (a === b || b === c || c === a) throw new Error(`영면적 삼각형 인덱스가 있습니다: ${index / 3}`);
    const coordinateKeys = [a, b, c].map(vertex => `${mesh.positions[vertex * 2]},${mesh.positions[vertex * 2 + 1]}`);
    if (new Set(coordinateKeys).size < 3) throw new Error(`패킹 후 겹친 꼭짓점이 있습니다: ${index / 3}`);
    const triangleKey = [a, b, c].sort((left, right) => left - right).join(':');
    if (triangleKeys.has(triangleKey)) throw new Error(`중복 삼각형이 있습니다: ${index / 3}`);
    triangleKeys.add(triangleKey);
    if (mesh.countryIndices[a] !== mesh.countryIndices[b] || mesh.countryIndices[b] !== mesh.countryIndices[c]) {
      throw new Error(`서로 다른 국가를 잇는 삼각형이 있습니다: ${index / 3}`);
    }
    maximumTriangleEdge = Math.max(maximumTriangleEdge, edgeDegrees(a, b), edgeDegrees(b, c), edgeDegrees(c, a));
  }
  if (maximumTriangleEdge > meshCore.MAX_RENDER_EDGE_DEGREES + 1e-9) {
    throw new Error(`패킹 후 최대 구면 변 길이가 초과되었습니다: ${maximumTriangleEdge}`);
  }
  for (let index = 0; index < mesh.lineIndices.length; index += 2) {
    const a = mesh.lineIndices[index];
    const b = mesh.lineIndices[index + 1];
    if (a === b) throw new Error(`영길이 국경선 인덱스가 있습니다: ${index / 2}`);
    if (mesh.countryIndices[a] !== mesh.countryIndices[b]) throw new Error(`서로 다른 국가를 잇는 국경선이 있습니다: ${index / 2}`);
  }
  return maximumTriangleEdge;
}

const sourceBytes = fs.readFileSync(sourcePath);
const countries = JSON.parse(sourceBytes.toString('utf8'));
if (countries?.type !== 'FeatureCollection' || countries.features?.length !== 258) {
  throw new Error('Natural Earth 국가 데이터는 정확히 258개여야 합니다.');
}
const ids = countries.features.map((feature, index) => String(feature.properties?.editor_id || feature.properties?.iso_a3 || index));
if (new Set(ids).size !== ids.length) throw new Error('국가 ID가 중복되었습니다.');
const sourceCoordinateCount = countCoordinates(countries.features.map(feature => feature.geometry?.coordinates));
if (sourceCoordinateCount !== 548466) throw new Error(`원본 좌표 수가 변경되었습니다: ${sourceCoordinateCount}`);

const startedAt = performance.now();
const mesh = meshCore.buildGpuMeshFeatures(countries.features, earcut, { validate: true });
const vertexCount = mesh.positions.length / 2;
validateIndices(mesh.triangleIndices, vertexCount, 3, '삼각형');
validateIndices(mesh.lineIndices, vertexCount, 2, '국경선');
if (mesh.countryIds.length !== 258 || mesh.countryIndices.length !== vertexCount) {
  throw new Error('국가 또는 꼭짓점 메타데이터 길이가 올바르지 않습니다.');
}
const packedMaximumEdgeDegrees = validatePackedGeometry(mesh);

const headerBytes = 8 * Uint32Array.BYTES_PER_ELEMENT;
const countryBytesPadded = (mesh.countryIndices.byteLength + 3) & ~3;
const rawByteLength = headerBytes + mesh.positions.byteLength + countryBytesPadded + mesh.triangleIndices.byteLength + mesh.lineIndices.byteLength;
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
if (offset !== raw.length) throw new Error(`GPU 메시 패킹 길이가 일치하지 않습니다: ${offset} / ${raw.length}`);

const compressed = zlib.gzipSync(raw, { level: 9, mtime: 0 });
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, compressed);

console.log(JSON.stringify({
  output: path.relative(projectRoot, outputPath).replaceAll('\\', '/'),
  sourceSha256: sha256(sourceBytes),
  meshSha256: sha256(compressed),
  countries: mesh.countryIds.length,
  sourceCoordinates: sourceCoordinateCount,
  vertices: vertexCount,
  triangles: mesh.triangleIndices.length / 3,
  lineSegments: mesh.lineIndices.length / 2,
  polarPolygons: mesh.stats.polarPolygonCount,
  removedDegenerateTriangles: mesh.stats.removedDegenerateTriangleCount,
  maxEdgeDegrees: packedMaximumEdgeDegrees,
  algorithmRevision: meshCore.MESH_ALGORITHM_REVISION,
  rawBytes: raw.length,
  compressedBytes: compressed.length,
  buildMilliseconds: Math.round(performance.now() - startedAt),
}, null, 2));
