import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildBuiltinWorldPublication} from '../../../tools/build/build-builtin-world.mjs';
import {historicalWorldCases} from '../../fixtures/historical-world-cases.mjs';
import {withExplicitView} from '../../helpers/builtin-world.mjs';
import {createBuiltinWorldLoader} from '../../../src/data/builtin-world-loader.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixture=()=>buildBuiltinWorldPublication({input:withExplicitView(historicalWorldCases())});
function reader(files){
  const requests=[],bytes=files.get('index.json');
  const loader=createBuiltinWorldLoader({manifestUrl:'https://test.invalid/data/index.json',
    manifestSpec:{sha256:sha(bytes),encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length},
    dataRevision:'read-index-fixture',cacheStorage:null,fetchFn:async url=>{
      const file=new URL(url).pathname.slice('/data/'.length);requests.push(file);
      if(file.startsWith('countries/')||file.startsWith('country-parts/'))return new Response('Viewer must not request authoring descriptors',{status:400});
      const bytes=files.get(file);return new Response(bytes,{status:bytes?200:404});
    }});
  return {loader,requests};
}
test('publication contains a complete coordinate-free temporal read index',()=>{
  const files=fixture(),index=JSON.parse(files.get('index.json'));
  assert.equal(index.readIndex?.schemaVersion,1);
  assert.deepEqual(index.readIndex.identities.map(row=>row.id),index.entities.map(row=>row.entityId));
  assert.deepEqual(index.readIndex.sourceHashes,index.entities.map(row=>row.sha256));
  assert.equal(index.readIndex.records.schemaVersion,3);
  assert.ok(index.readIndex.records.geometryBindings.some(row=>row.validTo!==null));
  assert.equal(Object.hasOwn(index.readIndex,'geometries'),false);
  assert.equal(JSON.stringify(index.readIndex).includes('"coordinates"'),false);
});
test('initial reads and later dates never fetch or assemble country authoring descriptors',async()=>{
  const files=fixture(),index=JSON.parse(files.get('index.json')),f=reader(files);
  const first=await f.loader.loadProject('2014-02');
  assert.equal(first.project.territorialEntities.length,index.entities.length);
  assert.ok(first.project.timelineRecords.geometryBindings.some(row=>row.validTo!==null));
  assert.ok(first.project.geometries.length<index.geometryAssets.length);
  assert.equal(f.requests.filter(path=>path==='index.json').length,1);
  const before=f.requests.length;
  const next=await f.loader.loadProject('2020-11');
  assert.equal(first.project.timelineRecords,next.project.timelineRecords,'immutable temporal metadata is reused, not reconstructed per date');
  assert.ok(f.requests.length<=before+2,'only newly needed geometry may be loaded');
  assert.ok(f.requests.every(path=>path==='index.json'||path.startsWith('geometries/')));
});
test('obsolete or stale temporal read index is rejected before loading coordinates',async()=>{
  for(const mutate of [index=>{delete index.readIndex;},index=>{if(index.readIndex)index.readIndex.sourceHashes[0]='0'.repeat(64);}]){
    const files=fixture(),index=JSON.parse(files.get('index.json'));mutate(index);
    files.set('index.json',Buffer.from(JSON.stringify(index)));
    const f=reader(files);
    await assert.rejects(f.loader.loadProject('2014-02'),/read index|temporal index/i);
    assert.ok(f.requests.every(path=>path==='index.json'));
  }
});
