import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {existsSync} from 'node:fs';
import {finalizeBuiltinWorldFiles} from "../../../tools/build/build-builtin-world.mjs";
import {createBuiltinWorldLoader} from "../../../src/data/builtin-world-loader.js";
const LIMIT=512*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
 const value={schemaVersion:3,entityId:'state:big',identity:{id:'state:big',properties:{name:'Big',padding:randomBytes(700000).toString('base64')}},
  sourceBindings:[],geometryRefs:[],timelineRecords:{schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]}};
 const decoded=Buffer.from(JSON.stringify(value)),bytes=gzipSync(decoded),digest=hash(bytes);
 const entry={geometryRefs:[],entityId:value.entityId,file:`countries/state-big-sha256-${digest}.json.gz`,encoding:'gzip',sha256:digest,compressedBytes:bytes.length,decodedBytes:decoded.length,coverage:[{validFrom:null,validTo:null}]};
 const index={schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'descriptor-geometries-v1',geometryAssets:[],template:{format:'pandolab-project-state',schemaVersion:14},entities:[entry]};
 return {index,entry,bytes,value};
}
function split(f){
 const files=new Map();f.entry.parts=[];
 for(let start=0;start<f.bytes.length;start+=LIMIT){const bytes=f.bytes.subarray(start,start+LIMIT),sha256=hash(bytes),file=`country-parts/sha256-${sha256}.bin`;
  f.entry.parts.push({file,encoding:'identity',sha256,compressedBytes:bytes.length,decodedBytes:bytes.length});files.set(file,bytes);}
 files.set('index.json',Buffer.from(JSON.stringify(f.index)));return files;
}
test('generation bounds oversized country files without changing their stored bytes or forming a world transport',()=>{
 const f=fixture(),files=new Map([[f.entry.file,f.bytes]]);finalizeBuiltinWorldFiles(f.index,files);
 assert.ok(f.entry.parts?.length>=2,'oversized countries need independently hashed parts');
 assert.equal(files.has(f.entry.file),false,'the oversized original is not a generated transfer file');
 assert.deepEqual(Buffer.concat(f.entry.parts.map(part=>files.get(part.file))),f.bytes);
 for(const part of f.entry.parts){assert.ok(part.compressedBytes<=LIMIT);assert.equal(hash(files.get(part.file)),part.sha256);}
 assert.equal(Object.hasOwn(f.index,'transport'),false);
});
test('the loader reads bounded parts, never requests the oversized original and preserves the country payload',async()=>{
 const f=fixture(),files=split(f),manifest=files.get('index.json'),calls=[];
 const loader=createBuiltinWorldLoader({manifestUrl:'https://test.local/data/index.json',manifestSpec:{encoding:'identity',sha256:hash(manifest),compressedBytes:manifest.length,decodedBytes:manifest.length},dataRevision:'parts',cacheStorage:null,
  fetchFn:async url=>{const file=new URL(url).pathname.slice('/data/'.length);calls.push(file);const bytes=files.get(file);return new Response(bytes,{status:bytes?200:404});}});
 const result=await loader.loadProject('2026-11');
 assert.deepEqual(result.project.territorialEntities[0],f.value.identity);
 assert.deepEqual(calls,['index.json',...f.entry.parts.map(part=>part.file)]);
 await loader.loadProject('2026-11');assert.equal(calls.length,1+f.entry.parts.length);
});
test('partial generation reuses unchanged parts without reading or emitting them again',()=>{
 const f=fixture(),files=split(f),before=structuredClone(f.index),next=structuredClone(f.index);
 const generated=new Map([[f.entry.file,f.bytes]]);finalizeBuiltinWorldFiles(next,generated,{previousIndex:before});
 assert.deepEqual([...generated.keys()],['index.json']);assert.deepEqual(next,before);
 assert.ok(files.size>2);
});
test('remote storage plans include the index and changed files only, never an oversized original or an unrelated country',async()=>{
 const moduleUrl=new URL("../../../tools/data/builtin-country-storage.mjs",import.meta.url);
 assert.ok(existsSync(moduleUrl),'the scoped country storage owner is required');
 const {planBuiltinCountryStorage}=await import(moduleUrl.href);
 const f=fixture();split(f);const previous=structuredClone(f.index),next=structuredClone(f.index);
 const last=next.entities[0].parts.at(-1),bytes=Buffer.alloc(last.compressedBytes,42);last.sha256=hash(bytes);last.file=`country-parts/sha256-${last.sha256}.bin`;
 next.entities[0].sha256='b'.repeat(64);next.entities[0].file=`countries/state-big-sha256-${next.entities[0].sha256}.json.gz`;
 const plan=planBuiltinCountryStorage(previous,next);
 assert.deepEqual(plan.prefixes,['assets/data/builtin-world/generated/v1/index.json','assets/data/builtin-world/generated/v1/'+last.file]);
 assert.equal(plan.changedCountries.length,1);assert.deepEqual(planBuiltinCountryStorage(previous,previous).prefixes,[]);
});
