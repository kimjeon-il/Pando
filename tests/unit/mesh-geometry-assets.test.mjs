import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function decodeMesh(relativePath) {
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(projectRoot, relativePath)));
  const header = new Uint32Array(raw.buffer, raw.byteOffset, 8);
  const [magic, version, countries, vertexCount, triangleIndexCount, lineIndexCount, sourceCoordinates, revision] = header;
  assert.equal(magic, 0x434d4731);
  assert.equal(version, 1);
  assert.equal(countries, 258);
  assert.equal(revision, 3);
  assert.ok(sourceCoordinates > 0);
  let offset = 8 * Uint32Array.BYTES_PER_ELEMENT;
  const positions = new Int32Array(raw.buffer, raw.byteOffset + offset, vertexCount * 2);
  offset += positions.byteLength;
  const countryIndices = new Uint16Array(raw.buffer, raw.byteOffset + offset, vertexCount);
  offset += (countryIndices.byteLength + 3) & ~3;
  const triangleIndices = new Uint32Array(raw.buffer, raw.byteOffset + offset, triangleIndexCount);
  offset += triangleIndices.byteLength;
  const lineIndices = new Uint32Array(raw.buffer, raw.byteOffset + offset, lineIndexCount);
  offset += lineIndices.byteLength;
  assert.equal(offset, raw.byteLength);
  return { countries, vertexCount, positions, countryIndices, triangleIndices, lineIndices };
}

function assertMeshGeometry(relativePath) {
  const mesh = decodeMesh(relativePath);
  const { countries, vertexCount, positions, countryIndices, triangleIndices, lineIndices } = mesh;
  for (const countryIndex of countryIndices) {
    if (countryIndex >= countries) throw new Error(`country index out of range: ${countryIndex}`);
  }
  const vectors = new Float64Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    const longitude = positions[index * 2] * 1e-6 * Math.PI / 180;
    const latitude = positions[index * 2 + 1] * 1e-6 * Math.PI / 180;
    const cosine = Math.cos(latitude);
    vectors[index * 3] = cosine * Math.cos(longitude);
    vectors[index * 3 + 1] = cosine * Math.sin(longitude);
    vectors[index * 3 + 2] = Math.sin(latitude);
  }
  const sameCoordinate = (left, right) => positions[left * 2] === positions[right * 2]
    && positions[left * 2 + 1] === positions[right * 2 + 1];
  assert.equal(triangleIndices.length % 3, 0);
  for (let index = 0; index < triangleIndices.length; index += 3) {
    const a = triangleIndices[index];
    const b = triangleIndices[index + 1];
    const c = triangleIndices[index + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) throw new Error(`triangle ${index / 3} index range`);
    if (sameCoordinate(a, b) || sameCoordinate(b, c) || sameCoordinate(c, a)) {
      throw new Error(`triangle ${index / 3} distinct packed vertices`);
    }
    if (countryIndices[a] !== countryIndices[b] || countryIndices[b] !== countryIndices[c]) throw new Error(`triangle ${index / 3} country`);
    const ab = [
      vectors[b * 3] - vectors[a * 3],
      vectors[b * 3 + 1] - vectors[a * 3 + 1],
      vectors[b * 3 + 2] - vectors[a * 3 + 2],
    ];
    const ac = [
      vectors[c * 3] - vectors[a * 3],
      vectors[c * 3 + 1] - vectors[a * 3 + 1],
      vectors[c * 3 + 2] - vectors[a * 3 + 2],
    ];
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2 <= 1e-32) throw new Error(`triangle ${index / 3} spherical area`);
  }
  assert.equal(lineIndices.length % 2, 0);
  for (let index = 0; index < lineIndices.length; index += 2) {
    const a = lineIndices[index];
    const b = lineIndices[index + 1];
    if (a >= vertexCount || b >= vertexCount) throw new Error(`line ${index / 2} index range`);
    if (positions[a * 2] === positions[b * 2] && positions[a * 2 + 1] === positions[b * 2 + 1]) {
      throw new Error(`line ${index / 2} length`);
    }
    if (countryIndices[a] !== countryIndices[b]) throw new Error(`line ${index / 2} country`);
  }
}

test('canonical and preview GPU mesh assets have no invalid indices or degenerate primitives', () => {
  assertMeshGeometry('assets/data/world-mesh-v0.12.6.bin.gz');
  assertMeshGeometry('assets/data/world-mesh-preview-v0.30.0.bin.gz');
});
