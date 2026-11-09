import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicalAssetReader} from '../../../src/data/physical-asset-reader.js';

const geometry={type:'MultiPolygon',coordinates:[[[[0,0],[0,1],[1,1],[0,0]]]]};
const meta=()=>({dataRevision:'data-test',
  physicalLand:{sha256:'a'.repeat(64),url:'assets/data/land.json'},
  initialLandPreview:{sha256:'b'.repeat(64),sourceSha256:'a'.repeat(64),
    url:'assets/data/preview.json',polygonCount:1}});
function fixture(buildMeta=meta()){
  const reads=[],invalidations=[];
  const reader=createPhysicalAssetReader({buildMeta,
    resolveBaseUrl:()=>new URL('https://example.invalid/assets/data/'),
    onLandReady:()=>invalidations.push('land-ready'),
    createLoader:({resolveUrl})=>({loadAsset:async(spec,priority,key,description,decode)=>{
      reads.push({key,priority,url:resolveUrl(spec)});
      return {value:decode(Buffer.from(JSON.stringify(geometry)))};
    }})});
  return {reader,reads,invalidations};
}
test('physical land loading is cached, pinned and notifies map owner only on demand',async()=>{
  const {reader,reads,invalidations}=fixture();
  assert.equal(reader.physicalLand,null);
  const first=await reader.loadPhysicalLandMask();
  assert.strictEqual(reader.physicalLand,first);
  assert.equal(first.revision,'a'.repeat(64));
  assert.strictEqual(await reader.loadPhysicalLandMask(),first);
  assert.deepEqual(invalidations,['land-ready']);
  assert.deepEqual(reads,[{key:'physical-land',priority:'background',
    url:'https://example.invalid/assets/data/land.json'}]);
});
test('initial preview is independent of map presentation and must match pinned physical land',async()=>{
  const f=fixture(),first=await f.reader.loadInitialLandPreview();
  assert.equal(first.certified,true);
  assert.equal(first.sourceRevision,'a'.repeat(64));
  assert.strictEqual(await f.reader.loadInitialLandPreview(),first);
  assert.equal(f.reads.length,1);
  assert.deepEqual(f.invalidations,[]);
  const changed=meta();changed.initialLandPreview.sourceSha256='foreign';
  await assert.rejects(fixture(changed).reader.loadInitialLandPreview(),/does not match/);
});
