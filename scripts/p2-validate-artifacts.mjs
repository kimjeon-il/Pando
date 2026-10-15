// Decode the actual generated packets, and verify Web/native consumption bytes.
import assert from 'node:assert/strict';
import { sharedSourceManifest } from '../tools/package-shared-core-assets.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { decodeCountryMesh } from '../assets/js/modules/country-mesh-codec.js';
import { decodePolygonMesh } from '../assets/js/modules/polygon-mesh-codec.js';
import { WEB_ASSET_ROLES } from '../native/tools/sync-world-data.mjs';
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
} else if(family==='native-assets') {
  const native=json('native/assets/world/manifest.json'),web=json('assets/data/world/current.json');
  assert.equal(native.origin.webCommit,process.env.PANDO_P2_SOURCE_SHA);
  assert.equal(native.origin.worldBundleSha256,sha(read('assets/data/world/current.json')));
  for(const [role,[webRole]] of Object.entries(WEB_ASSET_ROLES)) {
    assert.equal(native[role].source.ref,process.env.PANDO_P2_SOURCE_SHA);
    assert.deepEqual(read('native/assets/world/'+native[role].path),read('assets/data/'+web.assets[webRole].url),role);
  }
  for(const role of ['hydro','terrain']) {
    const spec=native[role];assert.deepEqual(read('native/assets/world/'+spec.path),read(spec.source.path),role);
    const manifest=json(spec.source.path);
    const parent=spec.source.path.slice(0,spec.source.path.lastIndexOf('/')+1);
    const target='native/assets/world/'+spec.path.slice(0,spec.path.lastIndexOf('/')+1);
    const assets=manifest.container?{[manifest.container.url]:manifest.container}:manifest.tiles;
    assert.ok(assets,'physical asset manifest');
    for(const [name,entry] of Object.entries(assets)) {
      const bytes=read(parent+name);assert.equal(sha(bytes),entry.sha256);
      assert.deepEqual(read(target+name),bytes,role+'/'+name);
    }
  }
  for(const file of ['manifest.json','places-v1.bin'])assert.deepEqual(read('native/assets/place/'+file),read('assets/data/places/'+file),'places/'+file);
  for(const file of ['manifest.json','world-project.json.gz','coverage-report.json','expected-trace.json'])
    assert.deepEqual(read('native/assets/world/historical-world/v1/'+file),read('assets/data/historical-world/generated/v1/'+file),'historical/'+file);
} else throw Error('P2_INVALID_VALIDATOR_FAMILY: '+family);
console.log('P2 validated actual '+family+' artifacts');
