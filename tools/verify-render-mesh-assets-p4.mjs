import assert from 'node:assert/strict';
import { sharedSourceManifest } from './package-shared-core-assets.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodePolygonMesh, POLYGON_MESH_FORMAT_VERSION } from "../shared/frontend/js/modules/polygon-mesh-codec.js";
import "../shared/frontend/js/workers/gpu-mesh-core.js";

const root = fileURLToPath(new URL('../', import.meta.url));
const data = resolve(root, 'assets/data');
const readJson = file => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const engine = globalThis.PandoLabGpuMeshCore;
const legacy = readJson('assets/data/world-preview-v0.36.1.json');
const bundle = readJson('assets/data/world/current.json');
const seed = readJson('assets/data/world/build-input.json');
const prepared = readJson('assets/data/prepared-polygons/generated/v2/manifest.json');
const oldPrepared = readJson('assets/data/prepared-polygons/generated/v1/manifest.json');
const algorithmSourceSha256 = sharedSourceManifest(root).sourceSha256;

assert.equal(engine.MESH_ALGORITHM_REVISION, 5);
assert.equal(legacy.version, '0.36.1');
assert.equal(legacy.meshAlgorithmRevision, 5);
assert.equal(bundle.derivation.meshAlgorithmRevision, 5);
assert.equal(seed.legacyPreviewManifest, 'world-preview-v0.36.1.json');
assert.equal(prepared.schemaVersion, 2);
assert.equal(prepared.meshFormatVersion, POLYGON_MESH_FORMAT_VERSION);
assert.equal(prepared.algorithmVersion, engine.MESH_ALGORITHM_REVISION);
assert.equal(prepared.maxEdgeDegrees, engine.MAX_RENDER_EDGE_DEGREES);
assert.equal(prepared.algorithmSourceSha256, algorithmSourceSha256);
assert.equal(oldPrepared.schemaVersion, 1, 'v1 must remain intact');

for (const role of ['previewCountries', 'previewMesh', 'canonicalCountryPacket', 'canonicalMesh', 'labelAnchors']) {
  const entry = bundle.assets[role], bytes = readFileSync(resolve(data, entry.url));
  const source = legacy.assets[role], oldAliasBytes = readFileSync(resolve(data, source.url));
  assert.equal(digest(bytes), entry.sha256, role + ' published checksum');
  assert.equal(bytes.byteLength, entry.compressedBytes, role + ' published size');
  assert.equal(digest(bytes), digest(oldAliasBytes), role + ' legacy alias identity');
  assert.equal(entry.sha256, source.sha256, role + ' manifest checksum');
  const decoded = entry.encoding === 'gzip' ? gunzipSync(bytes) : bytes;
  assert.equal(decoded.byteLength, entry.decodedBytes, role + ' decoded size');
  if (entry.header) assert.deepEqual([...new Uint32Array(decoded.buffer, decoded.byteOffset, entry.header.length)], entry.header);
}
assert.ok(bundle.assets.previewMesh.url.includes('-sha256-'));
assert.notEqual(bundle.assets.canonicalMesh.url, 'world-mesh-v0.12.6.bin.gz');
const expectedShared = { preview: 'countries-preview-shared-v0.36.1.json.gz',
  canonical: 'countries-canonical-shared-v0.36.1.json.gz' };
assert.deepEqual(bundle.compatibility.sharedBoundaries, expectedShared);
for (const [quality, file] of Object.entries(expectedShared)) {
  const raw = readFileSync(resolve(data, file)), value = JSON.parse(gunzipSync(raw));
  assert.equal(value.quality, quality);
  assert.equal(value.version, 1);
  assert.ok(value.segments.length > 0);
  assert.ok(Object.keys(value.signatures).length > 0);
}

const assets = Object.entries(prepared.meshes);
assert.equal(assets.length, 304, 'fixed shapes must not disappear from v2');
let totalCompressedBytes = 0;
let maxAsset = null;
for (const [geometryHash, entry] of assets) {
  assert.match(geometryHash, /^[a-f0-9]{64}$/);
  assert.ok(entry.url.startsWith('assets/data/prepared-polygons/generated/v2/'));
  const raw = readFileSync(resolve(root, entry.url));
  assert.equal(raw.length, entry.compressedBytes, entry.url + ' length');
  assert.equal(digest(raw), entry.sha256, entry.url + ' checksum');
  assert.equal(entry.encoding, 'gzip');
  totalCompressedBytes += raw.length;
  if (!maxAsset || entry.compressedBytes > maxAsset[1].compressedBytes) maxAsset = [geometryHash, entry];
}
for (const [hash, entry] of [assets[0], assets[Math.floor(assets.length / 2)], maxAsset]) {
  const decodedBytes = gunzipSync(readFileSync(resolve(root, entry.url)));
  assert.equal(decodedBytes.length, entry.decodedBytes, hash + ' decoded mesh size');
  const packet = decodePolygonMesh(decodedBytes.buffer.slice(decodedBytes.byteOffset, decodedBytes.byteOffset + decodedBytes.length),
    { algorithmVersion: engine.MESH_ALGORITHM_REVISION });
  assert.ok(packet.triangleCount > 0 && packet.segmentCount > 0);
  const triangleEdges = new Set(), key = (a, b) => a < b ? a + ':' + b : b + ':' + a;
  for (let i = 0; i < packet.indices.length; i += 3) {
    const a = packet.indices[i], b = packet.indices[i + 1], c = packet.indices[i + 2];
    triangleEdges.add(key(a, b)); triangleEdges.add(key(b, c)); triangleEdges.add(key(c, a));
  }
  for (let i = 0; i < packet.boundaryIndices.length; i += 2) {
    const a = packet.boundaryIndices[i], b = packet.boundaryIndices[i + 1];
    if (triangleEdges.has(key(a, b))) continue;
    const point = id => [packet.positions[id * 2], packet.positions[id * 2 + 1]];
    const sameGeo = (x, y) => {
      const left = point(x), right = point(y);
      return Math.abs(left[1] - right[1]) < 1e-6
        && Math.abs((left[0] - right[0]) / 360 - Math.round((left[0] - right[0]) / 360)) < 1e-6;
    };
    let geometricMatch = false, adjacentTriangles = 0;
    for (let j = 0; j < packet.indices.length; j += 3) {
      const [x, y, z] = packet.indices.slice(j, j + 3);
      for (const [u, v] of [[x, y], [y, z], [z, x]]) {
        if (sameGeo(a, u) || sameGeo(a, v) || sameGeo(b, u) || sameGeo(b, v)) adjacentTriangles++;
        if ((sameGeo(a, u) && sameGeo(b, v)) || (sameGeo(a, v) && sameGeo(b, u))) geometricMatch = true;
      }
    }
    throw new Error(hash + ': outline/fill mismatch: vertices ' + a + ' -> ' + b
      + ' positions=' + JSON.stringify([point(a), point(b)])
      + ' wrappingEquivalent=' + geometricMatch
      + ' adjacentTriangleEdges=' + adjacentTriangles
      + ' removedPolygonsNeedReview=true');
  }
}
console.log(JSON.stringify({ version: legacy.version, algorithmRevision: 5, fixedMeshCount: assets.length,
  fixedGzipBytes: totalCompressedBytes, largestMeshGzipBytes: maxAsset[1].compressedBytes,
  verifiedWorldAssets: Object.keys(bundle.assets).length, sharedCaches: 2 }, null, 2));
