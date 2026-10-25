import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { decodeCountryMesh } from "../../shared/frontend/js/modules/country-mesh-codec.js";

const countryCount=258;
function emptyMeshWithRevision(revision) {
  const words=12+countryCount*2+countryCount*2+countryCount*4+countryCount;
  const buffer=new ArrayBuffer(words*4);
  new Uint32Array(buffer,0,12).set([
    0x434d4731,2,countryCount,0,0,0,1,revision,
    countryCount*2,countryCount*2,countryCount*4,countryCount
  ]);
  return buffer;
}
test('the same v2 mesh decoder accepts the current shared fill revision 5',()=>{
  for(const revision of [5]) {
    const mesh=decodeCountryMesh(emptyMeshWithRevision(revision));
    assert.equal(mesh.mesh.countryBoundsFlags.length,countryCount);
    assert.equal(mesh.sourceCoordinateCount,1);
  }
});
test('unknown future algorithm revisions fail closed before buffer interpretation',()=>{
  for(const revision of [0,2,3,4,6,255])
    assert.throws(()=>decodeCountryMesh(emptyMeshWithRevision(revision)),/알고리즘 리비전/);
});
test('the currently published revision-5 preview mesh decodes exactly',()=>{
  const root=new URL('../../',import.meta.url);
  const bundle=JSON.parse(readFileSync(new URL('assets/data/world/current.json',root),'utf8'));
  const meshSpec=bundle.assets.previewMesh;
  const gz=readFileSync(new URL('assets/data/'+meshSpec.url,root));
  const binary=gunzipSync(gz);
  const uint8=new Uint8Array(binary.buffer,binary.byteOffset,binary.byteLength);
  const copy=Uint8Array.from(uint8).buffer;
  const decoded=decodeCountryMesh(copy);
  assert.equal(bundle.derivation.meshAlgorithmRevision,5);
  assert.equal(new Uint32Array(copy,0,8)[7],5);
  assert.equal(decoded.mesh.countryBoundsFlags.length,countryCount);
  assert.equal(decoded.sourceCoordinateCount,bundle.derivation.coordinateCount);
  assert.ok(decoded.mesh.triangleIndices.length>1000);
  assert.ok(decoded.mesh.lineIndices.length>1000);
});
