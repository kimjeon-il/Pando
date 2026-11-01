import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import * as publication from '../../tools/build-builtin-world.mjs';
import {territorialIndexEntry} from '../../apps/editor/frontend/js/modules/territorial-index-entry.js';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {withExplicitView} from '../helpers/builtin-world.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const catalog=input=>({entities:input.entities.map(entity=>territorialIndexEntry(entity,{sha256:sha(JSON.stringify(entity))}))});
const indexOf=files=>JSON.parse(files.get('index.json'));
const payloads=files=>[...files.keys()].filter(file=>file.startsWith('countries/'));
function fixture(){
 const input=withExplicitView(historicalWorldCases()),sourceIndex=catalog(input);
 const files=publication.buildBuiltinWorldPublication({input:{...input,sourceIndex}});
 return {input,sourceIndex,files,index:indexOf(files)};
}
function assertIndependent(index,files){
 assert.equal(index.schemaVersion,2,'the country payload schema is unchanged');
 assert.equal(index.storageLayout,'country-files-v1');
 assert.equal(Object.hasOwn(index,'transport'),false);
 assert.equal([...files.keys()].some(file=>file.startsWith('transport/')),false);
 assert.equal(files.has('world-project.json.gz'),false);
 for(const entry of index.entities){
  assert.equal(Object.hasOwn(entry,'offset'),false);
  assert.equal(entry.encoding,'gzip');
  assert.match(entry.file,/^countries\/[A-Za-z0-9_-]+-sha256-[a-f0-9]{64}\.json\.gz$/);
  assert.ok(Number.isSafeInteger(entry.compressedBytes)&&entry.compressedBytes>0);
  assert.ok(Number.isSafeInteger(entry.decodedBytes)&&entry.decodedBytes>0);
 }
}

test('full publication emits independent hashed countries, not a recombined transport',()=>{
 const {input,sourceIndex,files,index}=fixture();
 assertIndependent(index,files);
 assert.equal(payloads(files).length,index.entities.length);
 assert.deepEqual(files,publication.buildBuiltinWorldPublication({input:{...input,sourceIndex}}));
 for(const entry of index.entities){
  const bytes=files.get(entry.file);
  assert.equal(sha(bytes),entry.sha256);
  assert.equal(bytes.length,entry.compressedBytes);
  assert.equal(gunzipSync(bytes).length,entry.decodedBytes);
 }
});

test('partial geometry publication never reads or rewrites unrelated country payloads',t=>{
 const {input,sourceIndex:previousSourceIndex,files:before,index:previousIndex}=fixture();
 input.entities.find(entity=>entity.entityId==='current:KOR').lifetime.validFrom='1948-08-15';
 const sourceIndex=catalog(input),reads=[];
 const files=publication.buildBuiltinWorldPartialPublication({entityIds:['current:KOR'],sourceIndex,previousSourceIndex,
  previousIndex,previousCoverage:JSON.parse(before.get('coverage-report.json')),view:input.view,policy:input.policy,
  currentWorld:input.currentWorld,readSource:id=>{reads.push(id);return input.entities.find(entity=>entity.entityId===id);},
  readCountry:()=>{throw Error('Unrelated country payload must not be read');}});
 const index=indexOf(files),expected=publication.buildBuiltinWorldPublication({input:{...input,sourceIndex}});
 assertIndependent(index,files);
 assert.deepEqual(index.entities,indexOf(expected).entities);
 assert.equal(reads.includes('current:PRK'),false);
 const untouched=previousIndex.entities.find(entry=>entry.entityId==='PRK');
 assert.deepEqual(index.entities.find(entry=>entry.entityId==='PRK'),untouched);
 assert.equal(files.has(untouched.file),false);
 for(const entry of index.entities)assert.deepEqual(files.get(entry.file)||before.get(entry.file),expected.get(entry.file));
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'builtin-country-delta-'));
 t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 publication.writeBuiltinWorldPublication(before,folder);
 const target=path.join(folder,untouched.file),stamp=new Date('2000-01-01T00:00:00Z');
 fs.utimesSync(target,stamp,stamp);
 const mtime=fs.statSync(target).mtimeMs;
 publication.writeBuiltinWorldPublication(files,folder);
 publication.writeBuiltinWorldPublication(expected,folder,{check:true});
 assert.equal(fs.statSync(target).mtimeMs,mtime);
 assert.equal(sha(fs.readFileSync(target)),untouched.sha256);
});

test('name-only publication reads one country and preserves every other descriptor',()=>{
 const {input,files:before,index:previousIndex}=fixture();
 const prior=structuredClone(input.entities.find(entity=>entity.entityId==='current:RUS'));
 const updated={...prior,names:{ko:'수정명'}};
 input.entities[input.entities.findIndex(entity=>entity.entityId===prior.entityId)]=updated;
 const selected=previousIndex.entities.find(entry=>entry.entityId==='RUS'),reads=[];
 const files=publication.buildBuiltinWorldNamePublication({entityIds:[prior.entityId],sourceIndex:catalog(input),previousIndex,
  readSource:id=>{assert.equal(id,prior.entityId);return updated;},readPreviousSource:()=>prior,
  readCountry:file=>{reads.push(file);assert.equal(file,selected.file);return before.get(file);}});
 const index=indexOf(files);
 assertIndependent(index,files);
 assert.deepEqual(reads,[selected.file]);
 assert.equal(payloads(files).length,1);
 for(const entry of previousIndex.entities)if(entry.entityId!=='RUS'){
  assert.deepEqual(index.entities.find(row=>row.entityId===entry.entityId),entry);
  assert.equal(files.has(entry.file),false);
 }
 const original=JSON.parse(gunzipSync(before.get(selected.file)));
 const changed=JSON.parse(gunzipSync(files.get(index.entities.find(entry=>entry.entityId==='RUS').file)));
 assert.deepEqual(changed.geometries,original.geometries);
 assert.deepEqual(changed.timelineRecords.geometryBindings,original.timelineRecords.geometryBindings);
});

test('a no-op name publication emits no country bytes',()=>{
 const {input,sourceIndex,files:before,index:previousIndex}=fixture();
 const source=input.entities.find(entity=>entity.entityId==='current:RUS');
 const files=publication.buildBuiltinWorldNamePublication({entityIds:[source.entityId],sourceIndex,previousIndex,
  readSource:()=>source,readPreviousSource:()=>source,readCountry:file=>before.get(file)});
 assert.deepEqual(payloads(files),[]);
 assert.deepEqual(indexOf(files),previousIndex);
});

test('independent finalization requires new bytes and rejects corrupt or unreferenced output',()=>{
 assert.equal(typeof publication.finalizeBuiltinWorldFiles,'function');
 const {files,index}=fixture(),entry=index.entities[0];
 const missing=new Map(files);missing.delete(entry.file);
 assert.throws(()=>publication.finalizeBuiltinWorldFiles(structuredClone(index),missing),/Missing exact country bytes/);
 const corrupt=new Map(files);corrupt.set(entry.file,Buffer.from('corrupt'));
 assert.throws(()=>publication.finalizeBuiltinWorldFiles(structuredClone(index),corrupt),/country bytes/);
 const unreferenced=new Map(files);unreferenced.set('transport/retired.bin',Buffer.from('retired'));
 assert.throws(()=>publication.finalizeBuiltinWorldFiles(structuredClone(index),unreferenced),/Unexpected builtin output/);
 const previousIndex=structuredClone(index),changed=structuredClone(index);
 changed.entities[0].sha256='0'.repeat(64);
 changed.entities[0].file=`countries/${entry.entityId.replaceAll(':','-')}-sha256-${changed.entities[0].sha256}.json.gz`;
 assert.throws(()=>publication.finalizeBuiltinWorldFiles(changed,new Map(),{previousIndex}),/Missing exact country bytes/);
});

test('finalizing a selected publication drops old transport metadata without mutating its baseline',()=>{
 assert.equal(typeof publication.finalizeBuiltinWorldFiles,'function');
 const {index}=fixture(),previousIndex=structuredClone(index);
 previousIndex.transport={url:'transport/retired.bin'};
 previousIndex.entities.forEach((entry,i)=>{entry.offset=i;});
 const next=structuredClone(previousIndex),files=new Map();
 publication.finalizeBuiltinWorldFiles(next,files,{previousIndex});
 assertIndependent(indexOf(files),files);
 assert.equal(payloads(files).length,0);
 assert.ok(previousIndex.transport);
 assert.ok(previousIndex.entities.every(entry=>Object.hasOwn(entry,'offset')));
});
