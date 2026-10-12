import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {smallHistoricalWorld} from '../helpers/historical-world.mjs';
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {createHistoricalWorldLoader} from '../../assets/js/modules/historical-world-loader.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(project=smallHistoricalWorld()) {
 const decoded=Buffer.from('\n'+JSON.stringify(project,null,2)+'\r\n'),compressed=gzipSync(decoded);
 const spec={url:'project.gz',encoding:'gzip',compressedBytes:compressed.length,decodedBytes:decoded.length,sha256:hash(compressed)};
 const manifest=Buffer.from(JSON.stringify({schemaVersion:1,sourceMonth:'2026-10',project:spec}));
 const assets=new Map([['manifest.json',manifest],['project.gz',compressed]]),cache=new Map();let failNetwork=false,calls=0;
 const loader=createHistoricalWorldLoader({manifestUrl:'manifest.json',dataRevision:'test',
  manifestSpec:{encoding:'identity',compressedBytes:manifest.length,decodedBytes:manifest.length,sha256:hash(manifest)},
  fetchFn:async url=>{++calls;return new Response(failNetwork?'broken':assets.get(url));},
  cacheStorage:{open:async()=>({match:async url=>cache.has(url)?new Response(cache.get(url)):undefined,
   put:async(url,response)=>cache.set(url,Buffer.from(await response.arrayBuffer())),delete:async url=>cache.delete(url)})}});
 return {loader,project,decoded,cache,assets,get calls(){return calls;},fail:value=>{failNetwork=value;}};
}
const facts=({sourceBytes,manifest})=>({kind:'stored-asset',sourceBytes,encoding:'gzip',compressedBytes:manifest.project.compressedBytes,
 decodedBytes:manifest.project.decodedBytes,sourceMonth:manifest.sourceMonth,baseDataset:'fixture',fingerprint:manifest.project.sha256});
const validator=owner=>async source=>({baselineId:(await owner.client.storageBaselineLoad(facts(source))).state.storageBaselineId});

test('historical source retains only verified gzip bytes and the admitted Core handle, with no browser project decoding',async t=>{
 const input=fixture(),owner=await createNodeCoreProject(input.project);t.after(()=>owner.dispose());
 const previous=globalThis.DecompressionStream;globalThis.DecompressionStream=class {constructor(){throw new Error('Browser gzip decoder must not be used.');}};
 t.after(()=>{globalThis.DecompressionStream=previous;});
 const result=await input.loader.loadSource(validator(owner));
 assert.equal(result.manifest.sourceMonth,'2026-10');assert.ok(result.admission.baselineId>0);
 assert.deepEqual(result.sourceBytes,new Uint8Array(input.assets.get('project.gz')));assert.equal(hash(result.sourceBytes),result.manifest.project.sha256);
 assert.notEqual(hash(input.decoded),result.manifest.project.sha256);
 for(const field of ['project','projectJson','baseEntities'])assert.equal(Object.hasOwn(result,field),false);
 await owner.client.loadBaseline(result.admission.baselineId);assert.deepEqual(owner.documentModel.snapshot(),input.project);
});

test('Core decoded-format failures retain the original three network attempts and never change the active document',async t=>{
 const input=fixture({schemaVersion:999,unknown:null}),owner=await createNodeCoreProject(smallHistoricalWorld());t.after(()=>owner.dispose());
 const before=owner.client.state(),body=owner.documentModel.snapshot();let validations=0;
 await assert.rejects(input.loader.loadSource(async source=>{++validations;return validator(owner)(source);}));
 assert.equal(validations,3);assert.equal(input.calls,4);assert.equal(input.cache.has('project.gz'),false);
 assert.equal(owner.documentModel.snapshot(),body);assert.deepEqual(owner.client.state(),before);
});

test('a corrupt cached source is repaired before Core validation while network failures remain visible and retryable',async t=>{
 const input=fixture(),owner=await createNodeCoreProject(input.project);t.after(()=>owner.dispose());
 input.cache.set('project.gz',input.assets.get('project.gz').subarray(0,20));
 const result=await input.loader.loadSource(validator(owner));assert.ok(result.admission.baselineId>0);assert.equal(input.calls,2);
 input.cache.clear();input.fail(true);await assert.rejects(input.loader.loadSource(validator(owner)),/크기|무결성|size|integrity/);
 input.fail(false);assert.ok((await input.loader.loadSource(validator(owner))).admission.baselineId>0);
});

test('stale source admission cancels once instead of redownloading verified bytes',async()=>{
 const input=fixture(),error=Object.assign(new Error('stale source'),{code:'PL-CORE-STALE',name:'AbortError'});let validations=0;
 await assert.rejects(input.loader.loadSource(async()=>{++validations;throw error;}),value=>value===error);
 assert.equal(validations,1);assert.equal(input.calls,2);
});
