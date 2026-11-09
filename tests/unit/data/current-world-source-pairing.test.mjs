import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {buildCurrentWorld} from '../../../tools/data/territorial-current-world.mjs';
import {compileBuiltinWorldCatalog} from '../../../tools/build/builtin-world-compiler.mjs';
import {buildBuiltinWorldPublication,buildBuiltinWorldPartialPublication} from '../../../tools/build/build-builtin-world.mjs';
import {territorialIndexEntry} from '../../../tools/gis/territorial-index-entry.js';
import {historicalWorldCases} from '../../fixtures/historical-world-cases.mjs';
import {withExplicitView} from '../../helpers/builtin-world.mjs';
import {readTerritorialSource} from '../../../tools/data/territorial-entity-sources.mjs';
import {encodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {territorialSourceLayout} from '../../../src/data/territorial-source-format.js';
import {normalizeTerritorialLibraryEntity} from '../../../tools/gis/territorial-library.js';

const fixture=()=>withExplicitView(historicalWorldCases());
const indexOf=files=>JSON.parse(files.get('index.json'));
const changedWorld=input=>{
 const world=structuredClone(input.currentWorld);
 world.features.find(row=>row.id==='KOR').geometry.coordinates[0][1][0]+=0.25;
 return world;
};

test('current-world assertion compares selected geometry, not presentation metadata or JSON key order',()=>{
 const input=fixture(),expected=buildCurrentWorld(input),supplied=structuredClone(input.currentWorld);
 for(const row of supplied.features){row.properties={name:'Presentation only',color:'red'};row.geometry={coordinates:row.geometry.coordinates,bbox:[0,0,1,1],type:row.geometry.type};}
 supplied.features.reverse();
 const before=structuredClone(supplied);
 assert.deepEqual(buildCurrentWorld({...input,currentWorld:supplied}),expected);
 assert.deepEqual(supplied,before);
});

test('current-world assertion rejects a donor geometry under an unchanged canonical version',()=>{
 const input=fixture();
 assert.throws(()=>buildCurrentWorld({...input,currentWorld:changedWorld(input)}),/Current world source mismatch: current:KOR\/KOR:current/);
});

test('current-world assertion rejects missing, duplicate and unselected source feature identities',()=>{
 for(const mutate of [world=>world.features.pop(),world=>world.features.push(structuredClone(world.features[0])),world=>world.features[0].id='unselected']){
  const input=fixture();mutate(input.currentWorld);
  assert.throws(()=>buildCurrentWorld(input),/Current world source (identity|mismatch)/);
 }
});

test('direct compiler and full publication reject mismatched current-world input before geometry operations',()=>{
 const input=fixture();input.currentWorld=changedWorld(input);
 assert.throws(()=>compileBuiltinWorldCatalog({...input,clipper:{difference(){throw Error('must not reach clipping');}}}),/Current world source mismatch: current:KOR\/KOR:current/);
 assert.throws(()=>buildBuiltinWorldPublication({input}),/Current world source mismatch: current:KOR\/KOR:current/);
});

test('partial publication rejects selected donor mismatch while leaving unrelated sources unread',()=>{
 const input=fixture(),sourceIndex={entities:input.entities.map(row=>territorialIndexEntry(row,{sha256:'unchanged'}))};
 const before=buildBuiltinWorldPublication({input:{...input,sourceIndex}}),reads=[];
 const options={entityIds:['current:KOR'],sourceIndex,previousSourceIndex:sourceIndex,view:input.view,policy:input.policy,
  previousIndex:indexOf(before),previousCoverage:JSON.parse(before.get('coverage-report.json')),
  readSource:id=>{reads.push(id);return input.entities.find(row=>row.entityId===id);}};
 assert.throws(()=>buildBuiltinWorldPartialPublication({...options,currentWorld:changedWorld(input)}),/Current world source mismatch: current:KOR\/KOR:current/);
 assert.deepEqual(reads,['current:KOR']);
 for(const mutate of [world=>world.features.push(structuredClone(world.features[0])),world=>world.features[0].id='unselected']){
  const supplied=structuredClone(input.currentWorld);mutate(supplied);
  assert.throws(()=>buildBuiltinWorldPartialPublication({...options,currentWorld:supplied}),/Current world source identity/);
 }
 const supplied=structuredClone(input.currentWorld);supplied.features.find(row=>row.id==='PRK').geometry.coordinates[0][1][0]+=0.5;
 const actual=buildBuiltinWorldPartialPublication({...options,currentWorld:supplied});
 assert.deepEqual(indexOf(actual).entities,indexOf(before).entities);
 assert.equal(reads.includes('current:PRK'),false);
});

test('publication derives canonical geometry and metadata whether or not a matching assertion is supplied',()=>{
 const input=fixture(),{currentWorld,...canonical}=input;
 currentWorld.features.find(row=>row.id==='KOR').properties={name:'Ignored presentation',metadata:{flagDataUrl:'not-a-source-flag'}};
 assert.deepEqual(buildBuiltinWorldPublication({input}),buildBuiltinWorldPublication({input:canonical}));
});

test('partial assertions include selected source identities, not historical feature provenance',()=>{
 const input=fixture();input.entities.find(row=>row.entityId==='state:parent').sourceInfo={featureId:'KOR'};
 const sourceIndex={entities:input.entities.map(row=>territorialIndexEntry(row,{sha256:'fixture'}))},before=buildBuiltinWorldPublication({input:{...input,sourceIndex}});
 const reads=[],files=buildBuiltinWorldPartialPublication({entityIds:['state:parent'],sourceIndex,previousSourceIndex:sourceIndex,
  view:input.view,policy:input.policy,previousIndex:indexOf(before),previousCoverage:JSON.parse(before.get('coverage-report.json')),
  currentWorld:input.currentWorld,readSource:id=>{reads.push(id);return input.entities.find(row=>row.entityId===id);}});
 assert.deepEqual(indexOf(files).entities,indexOf(before).entities);
 assert.deepEqual(reads.sort(),['state:child','state:parent']);
});

function pairedSourceFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'current-source-pairing-')),sourceRoot=path.join(root,'source'),chunkRoot=path.join(root,'chunks');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(sourceRoot,'countries'),{recursive:true});fs.mkdirSync(chunkRoot);
 const raw={schemaVersion:2,entityId:'state:test',lineageId:'fixture',entityKind:'general',names:{en:'Test'},lifetime:{validFrom:null,validTo:null},
  parentEntityId:'',instantiation:{mode:'independent',countryUpdates:{}},metadata:{},sourceInfo:{featureId:'TST',featureProperties:{name:'Test'}},
  geometryVersions:[{versionId:'current',validFrom:null,validTo:null,geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}}]};
 const entity=normalizeTerritorialLibraryEntity(raw),decoded=Buffer.from(JSON.stringify(entity)),stored=gzipSync(decoded);stored[4]=7;
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const sourceIndex={entities:[territorialIndexEntry(entity,{sha256:sha(stored),compressedBytes:stored.length,decodedBytes:decoded.length})]};
 const sourceFile=path.join(sourceRoot,'countries/state-test.json'),chunkFile=path.join(chunkRoot,sourceIndex.entities[0].file);
 const writeSource=()=>{
  const {descriptor,geometries}=encodeTerritorialSource(raw);
  for(const [file,bytes]of geometries){
   const destination=path.join(sourceRoot,file);
   fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);
  }
  fs.writeFileSync(sourceFile,JSON.stringify(descriptor));
 };
 writeSource();fs.writeFileSync(chunkFile,stored);
 return {raw,entity,sourceIndex,writeSource,chunkFile,stored,load:()=>readTerritorialSource('state:test',sourceRoot,{sourceIndex,chunkRoot})};
}

test('indexed source read preserves valid stored gzip identity without recompression',t=>{
 const f=pairedSourceFixture(t);assert.deepEqual(f.load(),f.entity);assert.deepEqual(fs.readFileSync(f.chunkFile),f.stored);
});

test('split indexed metadata preserves geometry identity without embedding coordinates',t=>{
 const f=pairedSourceFixture(t),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const {descriptor}=encodeTerritorialSource(f.entity),geometryRef=descriptor.geometryVersions[0].geometryResource;
 const decoded=Buffer.from(JSON.stringify(descriptor)+'\n'),stored=gzipSync(decoded);
 f.sourceIndex.entities[0]=territorialIndexEntry(f.entity,{sha256:sha(stored),compressedBytes:stored.length,
  decodedBytes:decoded.length,storageLayout:territorialSourceLayout});
 fs.writeFileSync(f.chunkFile,stored);
 assert.deepEqual(f.load(),f.entity);
 assert.equal(Object.hasOwn(JSON.parse(decoded).geometryVersions[0],'geometry'),false);
 f.raw.names.en='Changed metadata';f.writeSource();
 assert.throws(f.load,/Territorial source index mismatch: state:test/);
 const updated=normalizeTerritorialLibraryEntity(f.raw),next=encodeTerritorialSource(updated).descriptor;
 assert.equal(next.geometryVersions[0].geometryResource.sha256,geometryRef.sha256,'metadata edit does not replace immutable geometry');
 const changed=Buffer.from(JSON.stringify(next)+'\n'),compressed=gzipSync(changed);
 f.sourceIndex.entities[0]=territorialIndexEntry(updated,{sha256:sha(compressed),compressedBytes:compressed.length,
  decodedBytes:changed.length,storageLayout:territorialSourceLayout});
 fs.writeFileSync(f.chunkFile,compressed);
 assert.deepEqual(f.load(),updated);
});

test('indexed source read requires exactly one row for the consumed entity only',t=>{
 const f=pairedSourceFixture(t),entry=f.sourceIndex.entities[0];
 f.sourceIndex.entities.push({entityId:'state:unread'},{entityId:'state:unread'});
 assert.deepEqual(f.load(),f.entity,'unconsumed index rows require no payload read or validation');
 f.sourceIndex.entities.push({...entry,sha256:'0'.repeat(64),bbox:[-5,-5,5,5]});
 assert.throws(f.load,/Duplicate indexed territorial source: state:test/);
 f.sourceIndex.entities[f.sourceIndex.entities.length-1]=structuredClone(entry);
 assert.throws(f.load,/Duplicate indexed territorial source: state:test/,'even identical duplicate rows are ambiguous');
});

test('indexed source read rejects corrupted stored bytes and raw source changes under a stale chunk identity',t=>{
 const f=pairedSourceFixture(t);fs.appendFileSync(f.chunkFile,'corrupt');
 assert.throws(f.load,/Territorial source chunk hash mismatch: state:test/);
 fs.writeFileSync(f.chunkFile,f.stored);f.raw.geometryVersions[0].geometry.coordinates[0][1][0]=0.75;
 f.writeSource();
 assert.throws(f.load,/Territorial source\/chunk mismatch: state:test/);
});

test('indexed source read rejects stale metadata and bounding box before dependency planning',t=>{
 const f=pairedSourceFixture(t);f.sourceIndex.entities[0].bbox[0]=-5;
 assert.throws(f.load,/Territorial source index mismatch: state:test/);
 f.sourceIndex.entities[0].bbox[0]=0;f.sourceIndex.entities[0].names={en:'Stale'};
 assert.throws(f.load,/Territorial source index mismatch: state:test/);
});

test('partial execution verifies selected sources before bounds planning but plan-only reads no source',t=>{
 const f=pairedSourceFixture(t),view={schemaVersion:1,selections:[{entityId:'state:test',geometryVersionId:'current'}]},
  policy={schemaVersion:1,replacements:[]},sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const previousIndex={inputHashes:{view:sha(view),policy:sha(policy),sourceRevisions:{'state:test':f.sourceIndex.entities[0].sha256}},
  sourceIdentities:[{projectEntityId:'TST',sourceEntityIds:['state:test'],sourceFeatureIds:['TST']}]};
 let reads=0,planned=0;
 const options={entityIds:['state:test'],sourceIndex:f.sourceIndex,previousSourceIndex:f.sourceIndex,view,policy,previousIndex,
  previousCoverage:{adjustments:[]},readSource:()=>{reads++;return f.load();},onScope:()=>{planned++;}};
 f.sourceIndex.entities[0].bbox[0]=-5;
 assert.deepEqual(buildBuiltinWorldPartialPublication({...options,planOnly:true}).sourceIds,['state:test']);
 assert.equal(reads,0);assert.equal(planned,1);
 assert.throws(()=>buildBuiltinWorldPartialPublication(options),/Territorial source index mismatch: state:test/);
 assert.equal(reads,1);assert.equal(planned,1,'stale selected bounds must fail before execution scope is accepted');
});
