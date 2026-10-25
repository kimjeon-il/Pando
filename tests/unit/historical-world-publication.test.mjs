import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {buildBuiltinWorldPublication,buildBuiltinWorldPartialPublication,writeBuiltinWorldPublication} from '../../tools/build-builtin-world.mjs';
import {territorialIndexEntry} from '../../assets/js/modules/territorial-index-entry.js';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {withExplicitView} from '../helpers/builtin-world.mjs';
test('country publication is deterministic, has no aggregate project and detects stale output',t=>{
 const input=withExplicitView(historicalWorldCases());
 const first=buildBuiltinWorldPublication({input}),second=buildBuiltinWorldPublication({input});
 assert.deepEqual(first,second);assert.equal(first.has('world-project.json.gz'),false);
 const index=JSON.parse(first.get('index.json'));assert.equal(Object.hasOwn(index,'sourceMonth'),false);
 for(const row of index.entities)assert.equal(first.get(row.file)[9],3);
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'builtin-country-publication-'));
 t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 writeBuiltinWorldPublication(first,folder);writeBuiltinWorldPublication(second,folder,{check:true});
 fs.appendFileSync(path.join(folder,'index.json'),'stale');
 assert.throws(()=>writeBuiltinWorldPublication(first,folder,{check:true}),/stale/i);
});
test('country publication rejects a missing policy',()=>{
 assert.throws(()=>buildBuiltinWorldPublication({policyFile:path.join(os.tmpdir(),'missing-history-policy.json')}),/ENOENT|missing/i);
});

test('country publication preserves independent source lifetimes without inventing historical availability',()=>{
 const input=withExplicitView(historicalWorldCases());
 input.entities.find(row=>row.entityId==='current:KOR').lifetime.validFrom='1948-08-15';
 const files=buildBuiltinWorldPublication({input}),index=JSON.parse(files.get('index.json'));
 const country=id=>JSON.parse(gunzipSync(files.get(index.entities.find(row=>row.entityId===id).file)));
 const kor=country('KOR'),rus=country('RUS'),parent=country('state:parent');
 assert.equal(kor.timelineRecords.lifetimes[0].validFrom,'1948-08-15');
 assert.equal(kor.timelineRecords.lifetimes[0].validTo,null);
 assert.equal(rus.timelineRecords.lifetimes[0].validFrom,null);
 assert.equal(rus.timelineRecords.lifetimes[0].validTo,null);
 assert.equal(parent.timelineRecords.lifetimes.length,1);
 assert.deepEqual(parent.timelineRecords.lifetimes.map(({validFrom,validTo})=>({validFrom,validTo})),[{validFrom:'1900',validTo:'1903'}]);
 assert.deepEqual(index.entities.find(row=>row.entityId==='KOR').coverage,[{validFrom:'1948-08-15',validTo:null}]);
 assert.equal(parent.timelineRecords.geometryBindings.length,2,'the geometry gap remains distinct from the lifetime');
});

test('partial publication rebuilds a changed lifetime and its overlapping peer, reusing unrelated country bytes',()=>{
 const input=withExplicitView(historicalWorldCases());
 const changed=input.entities.find(row=>row.entityId==='state:test-ukraine');
 changed.geometryVersions[0].geometry=structuredClone(input.currentWorld.features.find(row=>row.id==='RUS').geometry);
 const previousSourceIndex={entities:input.entities.map(entity=>territorialIndexEntry(entity,{sha256:'before',compressedBytes:1,decodedBytes:1}))};
 const before=buildBuiltinWorldPublication({input:{...input,sourceIndex:previousSourceIndex}});
 // The current RUS square overlaps this historical source. Removing the old
 // overlap must restore RUS, rather than just trimming the changed country's dates.
 changed.lifetime.validFrom='2010';
 const sourceIndex={entities:input.entities.map(entity=>territorialIndexEntry(entity,{sha256:entity===changed?'after':'before',compressedBytes:1,decodedBytes:1}))};
 const reads=[];
 const partial=buildBuiltinWorldPartialPublication({entityIds:[changed.entityId],sourceIndex,previousSourceIndex,
  view:input.view,policy:input.policy,previousIndex:JSON.parse(before.get('index.json')),
  previousCoverage:JSON.parse(before.get('coverage-report.json')),
  readSource:id=>{reads.push(id);return input.entities.find(row=>row.entityId===id);},
  readCountry:file=>before.get(file),
  currentWorld:input.currentWorld});
 const expected=buildBuiltinWorldPublication({input});
 const actualIndex=JSON.parse(partial.get('index.json')),expectedIndex=JSON.parse(expected.get('index.json'));
 assert.deepEqual(actualIndex.entities,expectedIndex.entities);
 for(const entry of actualIndex.entities)assert.deepEqual(partial.get(entry.file),expected.get(entry.file));
 assert.equal(reads.includes('current:KOR'),false,'unrelated sources must not be read or normalized');
 assert.equal(reads.includes(changed.entityId),true);
 assert.deepEqual(JSON.parse(partial.get('coverage-report.json')),JSON.parse(expected.get('coverage-report.json')));
 assert.equal(JSON.parse(before.get('index.json')).entities.find(row=>row.entityId==='KOR').file,
  actualIndex.entities.find(row=>row.entityId==='KOR').file);
});

test('partial lifetime generation carries parent gaps to children and plans without reading country sources',()=>{
 const input=withExplicitView(historicalWorldCases());
 const previousSourceIndex={entities:input.entities.map(entity=>territorialIndexEntry(entity,{}))};
 const before=buildBuiltinWorldPublication({input:{...input,sourceIndex:previousSourceIndex}});
 input.entities.find(row=>row.entityId==='state:parent').lifetime.validFrom='1902';
 const sourceIndex={entities:input.entities.map(entity=>territorialIndexEntry(entity,{}))};
 const options={entityIds:['state:parent'],sourceIndex,previousSourceIndex,view:input.view,policy:input.policy,
  previousIndex:JSON.parse(before.get('index.json')),previousCoverage:JSON.parse(before.get('coverage-report.json')),
  currentWorld:input.currentWorld,readCountry:file=>before.get(file),readSource:()=>{throw new Error('unplanned source read');}};
 const plan=buildBuiltinWorldPartialPublication({...options,planOnly:true});
 assert.ok(plan.sourceIds.includes('state:child'));
 assert.equal(plan.sourceIds.includes('current:KOR'),false);
 assert.throws(()=>buildBuiltinWorldPartialPublication({...options,entityIds:['state:missing'],planOnly:true}),/Unknown scoped source/);
 assert.throws(()=>buildBuiltinWorldPartialPublication({...options,policy:{...input.policy,replacements:[{}]},planOnly:true}),/policy changed/);
 const files=buildBuiltinWorldPartialPublication({...options,readSource:id=>input.entities.find(row=>row.entityId===id)});
 const index=JSON.parse(files.get('index.json')),child=index.entities.find(row=>row.entityId==='state:child');
 assert.deepEqual(child.coverage,[{validFrom:'1902-01-01',validTo:'1903-12-31'}]);
 const country=JSON.parse(gunzipSync(files.get(child.file)));
 assert.equal(country.timelineRecords.lifetimes[0].validFrom,'1900','a parent gap must not rewrite the child lifetime');
 assert.deepEqual(index.entities,JSON.parse(buildBuiltinWorldPublication({input}).get('index.json')).entities);
});

test('partial generation discovers the first overlap across the antimeridian after lifetime expansion',()=>{
 const input=withExplicitView(historicalWorldCases());
 const changed=input.entities.find(row=>row.entityId==='state:test-ukraine');
 changed.geometryVersions[0].validFrom='1980';
 changed.geometryVersions[0].geometry={type:'Polygon',coordinates:[[[179,60],[-179,60],[-179,61],[179,61],[179,60]]]};
 const peer=input.entities.find(row=>row.entityId==='state:single-day');
 peer.geometryVersions[0].geometry={type:'Polygon',coordinates:[[[179.2,60.2],[179.8,60.2],[179.8,60.8],[179.2,60.8],[179.2,60.2]]]};
 const previousSourceIndex={entities:input.entities.map(entity=>territorialIndexEntry(entity,{}))};
 const before=buildBuiltinWorldPublication({input:{...input,sourceIndex:previousSourceIndex}});
 changed.lifetime.validFrom='1989';
 const sourceIndex={entities:input.entities.map(entity=>territorialIndexEntry(entity,{}))};
 const files=buildBuiltinWorldPartialPublication({entityIds:[changed.entityId],sourceIndex,previousSourceIndex,
  view:input.view,policy:input.policy,previousIndex:JSON.parse(before.get('index.json')),previousCoverage:JSON.parse(before.get('coverage-report.json')),
  currentWorld:input.currentWorld,readSource:id=>input.entities.find(row=>row.entityId===id),readCountry:file=>before.get(file)});
 assert.deepEqual(JSON.parse(files.get('index.json')).entities,JSON.parse(buildBuiltinWorldPublication({input}).get('index.json')).entities);
});

test('partial provenance retains the old revision of an unread, independently edited source',()=>{
 const input=withExplicitView(historicalWorldCases());
 const previousSourceIndex={entities:input.entities.map(entity=>territorialIndexEntry(entity,{sha256:'before'}))};
 const before=buildBuiltinWorldPublication({input:{...input,sourceIndex:previousSourceIndex}});
 input.entities.find(row=>row.entityId==='current:KOR').lifetime.validFrom='1948-08-15';
 input.entities.find(row=>row.entityId==='current:PRK').lifetime.validFrom='1948-09-09';
 const sourceIndex={entities:input.entities.map(entity=>territorialIndexEntry(entity,{sha256:entity.entityId==='current:KOR'?'finished':entity.entityId==='current:PRK'?'unfinished':'before'}))};
 const reads=[];
 const files=buildBuiltinWorldPartialPublication({entityIds:['current:KOR'],sourceIndex,previousSourceIndex,view:input.view,policy:input.policy,
  previousIndex:JSON.parse(before.get('index.json')),previousCoverage:JSON.parse(before.get('coverage-report.json')),currentWorld:input.currentWorld,
  readSource:id=>{reads.push(id);return input.entities.find(row=>row.entityId===id);},readCountry:file=>before.get(file)});
 const index=JSON.parse(files.get('index.json'));
 assert.equal(reads.includes('current:PRK'),false);
 assert.equal(index.entities.find(row=>row.entityId==='PRK').file,JSON.parse(before.get('index.json')).entities.find(row=>row.entityId==='PRK').file);
 assert.equal(index.inputHashes.sourceRevisions['current:KOR'],'finished');
 assert.equal(index.inputHashes.sourceRevisions['current:PRK'],'before');
 assert.notEqual(index.inputHashes.entities,JSON.parse(buildBuiltinWorldPublication({input:{...input,sourceIndex}}).get('index.json')).inputHashes.entities);
});
