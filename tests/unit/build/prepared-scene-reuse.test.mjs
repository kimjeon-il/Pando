import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {reusePreparedSceneReceipt} from '../../../tools/build/prepared-scene-reuse.mjs';
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const bytes=Buffer.from('immutable-mesh');
const hash=sha(bytes);
const source={countryPacket:'a'.repeat(64),canonicalMesh:'b'.repeat(64),builtinIndex:'c'.repeat(64)};
const identity={fills:[['A','d'.repeat(64)]],boundaries:[['A','d'.repeat(64),'A','','general']]};
const spec={url:'world/objects/country-scene-sha256-'+hash+'.bin.gz',sha256:hash,encoding:'gzip',
 compressedBytes:bytes.length,decodedBytes:100,referenceMonth:'1920-01',algorithmVersion:6,identity,source};
test('metadata-only catalog revision retains immutable prepared bytes and refreshes only provenance',()=>{
 let reads=0;
 const current={...source,builtinIndex:'e'.repeat(64)};
 const result=reusePreparedSceneReceipt({spec,identity,source:current,referenceMonth:'1920-01',
  algorithmVersion:6,readStored:url=>{assert.equal(url,spec.url);reads++;return bytes;}});
 assert.equal(reads,1);assert.ok(result);
 assert.equal(result.spec.sha256,spec.sha256);
 assert.equal(result.spec.source.builtinIndex,current.builtinIndex);
 assert.strictEqual(result.spec.identity,identity);
 assert.equal(spec.source.builtinIndex,source.builtinIndex);
});
test('changed geometry, date, mesh algorithm or canonical assets cannot reuse a scene',()=>{
 const run=(patch={})=>reusePreparedSceneReceipt({spec,identity,source,
  referenceMonth:'1920-01',algorithmVersion:6,readStored:()=>bytes,...patch});
 assert.equal(run({identity:{...identity,boundaries:[]}}),null);
 assert.equal(run({referenceMonth:'1920-02'}),null);
 assert.equal(run({algorithmVersion:7}),null);
 assert.equal(run({source:{...source,canonicalMesh:'f'.repeat(64)}}),null);
 assert.throws(()=>run({readStored:()=>Buffer.from('corrupted')}),/SHA-256/);
});
