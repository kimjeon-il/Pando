// Decode the actual generated packets and verify current Web/WASM consumption bytes.
import assert from 'node:assert/strict';
import { sharedSourceManifest } from '../tools/package-shared-core-assets.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { decodeCountryMesh } from "../shared/frontend/js/modules/country-mesh-codec.js";
import { decodePolygonMesh } from "../shared/frontend/js/modules/polygon-mesh-codec.js";
import { safePath } from './lib/p2-artifact-graph.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFileSync(safePath(root,p));
const json=p=>JSON.parse(read(p));
const sha=b=>createHash('sha256').update(b).digest('hex');
const array=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const family=process.argv[2];
if(family==='world-mesh') {
  const seed=json('assets/data/world/build-input.json'),legacy=json('assets/data/'+seed.legacyPreviewManifest);
  const {mesh}=decodeCountryMesh(array(gunzipSync(read('assets/data/'+legacy.assets.canonicalMesh.url))));
  const vertices=mesh.positions.length/2;
  assert.equal(mesh.triangleIndices.length%3,0);
  assert.equal(mesh.lineIndices.length%2,0);
  for(const index of mesh.triangleIndices)assert.ok(index<vertices,'triangle index');
  for(const index of mesh.lineIndices)assert.ok(index<vertices,'line index');
} else if(family==='prepared-mesh') {
  const manifest=json('assets/data/prepared-polygons/generated/v2/manifest.json');
  assert.equal(manifest.schema,'pandolab-prepared-polygon-meshes');
  assert.ok(Object.keys(manifest.meshes).length,'empty prepared meshes');
  assert.equal(sharedSourceManifest(root).sourceSha256,manifest.algorithmSourceSha256);
  for(const [path,hash] of Object.entries(manifest.inputHashes))assert.equal(sha(read(path)),hash,'prepared input '+path);
  for(const spec of Object.values(manifest.meshes)) {
    const bytes=read(spec.url);assert.equal(sha(bytes),spec.sha256);assert.equal(bytes.length,spec.compressedBytes);
    const raw=gunzipSync(bytes);assert.equal(raw.length,spec.decodedBytes);
    decodePolygonMesh(array(raw),{algorithmVersion:manifest.algorithmVersion});
  }
} else throw Error('P2_INVALID_VALIDATOR_FAMILY: '+family);
console.log('P2 validated actual '+family+' artifacts');
