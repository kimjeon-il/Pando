import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PUBLISHED_PREPARED_MESH_BYTES,
  publishedPreparedMeshBytes,
  isPublishedPreparedMeshSpec,
  publishedPreparedMeshManifest,
} from '../../../src/data/prepared-mesh-publication.js';

test('Viewer publishes only bounded immutable polygon accelerators', () => {
  const small={url:'assets/data/prepared-polygons/v2/small.gz',compressedBytes:65536};
  const large={url:'assets/data/prepared-polygons/v2/large.gz',compressedBytes:65537};
  assert.equal(MAX_PUBLISHED_PREPARED_MESH_BYTES,64*1024);
  assert.equal(isPublishedPreparedMeshSpec(small),true);
  assert.equal(isPublishedPreparedMeshSpec(large),false);
  assert.equal(isPublishedPreparedMeshSpec({compressedBytes:0}),false);
  assert.equal(isPublishedPreparedMeshSpec({compressedBytes:Infinity}),false);
  assert.equal(isPublishedPreparedMeshSpec({storageLayout:'prepared-mesh-delta-v1',
    base:{compressedBytes:32768},replacement:{compressedBytes:32769}}),false);
  assert.equal(publishedPreparedMeshBytes({storageLayout:'prepared-mesh-delta-v1',
    base:{compressedBytes:32768},replacement:{compressedBytes:32768}}),65536);
  const original={schema:'pandolab-prepared-polygon-meshes',meshes:{small,large}};
  const admitted=publishedPreparedMeshManifest(original);
  assert.deepEqual(Object.keys(admitted.meshes),['small']);
  assert.strictEqual(original.meshes.large,large,'Pinned source manifest must not be modified');
  assert.equal(original.meshes.small,small);
  assert.throws(()=>publishedPreparedMeshManifest({meshes:null}),/Invalid prepared/);
});
