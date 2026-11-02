import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {auditHydroParts,auditHydroSourceArchives,hydroPartsBySource,planHydroFeatureRepairs,planHydroSourceRepairs,repairHydroParts,validateHydroAudit,validateHydroRepair,verifyHydroStaged} from '../../tools/gis/hydro-connectivity-native.mjs';
import {readFile} from 'node:fs/promises';

const native = process.env.PANDO_HYDRO_CONNECTIVITY_BINARY;
function fixture() {
  const parts = {
    1: [{ fid: 1, part: 0, points: [[0, 0], [1, 0]], aligned: false, system: '10' }],
    2: [{ fid: 2, part: 0, points: [[1.002, 0], [2, 0]], aligned: true, system: '10' }],
    3: [{ fid: 3, part: 0, points: [[0, 1], [1, 0]], aligned: false, system: '10' }],
  };
  const raw = {
    1: { region: 'eu', next: 2, start: [0, 0], end: [1, 0] },
    2: { region: 'eu', next: 0, start: [1, 0], end: [2, 0] },
    3: { region: 'eu', next: 2, start: [0, 1], end: [1, 0] },
  };
  return { parts, raw, region: 'eu' };
}
function run(input) {
  assert.ok(native, 'PANDO_HYDRO_CONNECTIVITY_BINARY must be set in native CI');
  const result = spawnSync(native, [], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const nativeTest = (name, fn) => test(name, { skip: !native }, fn);
nativeTest('logical river chains preserve canonical confluence and input order',()=>{
  const reaches=[{id:1,next:3},{id:2,next:3},{id:3,next:4},{id:4,next:0}],canonical=[{downstream:3,upstream:1},{downstream:4,upstream:3}];
  assert.deepEqual(run({mode:'logical-chains',reaches,canonical}),{chains:[[2],[1,3,4]]});
  assert.deepEqual(run({mode:'logical-chains',reaches:[{id:9,next:0}],canonical:[]}),{chains:[[9]]});
  assert.deepEqual(run({mode:'logical-chains',reaches:[],canonical:[]}),{chains:[]});
});
nativeTest('logical river chains reject missing links, invalid choices and cycles',()=>{
  for(const input of [
    {reaches:[{id:1,next:9}],canonical:[]},
    {reaches:[{id:1,next:2},{id:2,next:0}],canonical:[{downstream:2,upstream:9}]},
    {reaches:[{id:1,next:2},{id:2,next:0}],canonical:[]},
    {reaches:[{id:1,next:0},{id:1,next:0}],canonical:[]},
    {reaches:[{id:1,next:2},{id:2,next:1}],canonical:[{downstream:1,upstream:2},{downstream:2,upstream:1}]},
  ]){
    const result=spawnSync(native,[],{input:JSON.stringify({mode:'logical-chains',...input}),encoding:'utf8'});
    assert.notEqual(result.status,0);assert.equal(result.stdout,'');
  }
});
nativeTest('river systems select mainstems and split stages without changing source order',()=>{
  const reach=(id,mainRiver,upstreamArea,flow,stage,borderPair,parts)=>({id,mainRiver,upstreamArea,flow,stage,borderPair,parts});
  const chains=[
    [reach(20,10,20,3,1,null,[[[181,1],[182,2]]])],
    [reach(10,10,100,4,1,null,[[[3,4],[4,5]]]),reach(11,10,110,5,2,['AAA','BBB'],[[[4,5],[5,6]]])],
    [reach(30,99,10,2,1,null,[[[6,7],[7,8]]])],
    [reach(31,99,30,1,1,null,[[[8,9],[9,10]]])],
  ];
  const actual=run({mode:'river-systems',chains});
  assert.deepEqual(actual.systems,[
    {systemId:10,chainIndexes:[1,0],mainstemIndex:1,bounds:[-179,1,5,6]},
    {systemId:99,chainIndexes:[3,2],mainstemIndex:3,bounds:[6,7,9,10]},
  ]);
  assert.deepEqual(actual.fragments,[[[20]],[[10],[11]],[[30]],[[31]]]);
  assert.deepEqual(run({mode:'river-systems',chains:[]}),{systems:[],fragments:[]});
  const ties=run({mode:'river-systems',chains:[
    [reach(3,6,1,0,1,['AAA','BBB'],[[[4,4]]]),reach(4,5,2,0,1,['AAA','CCC'],[])],
    [reach(19,0,1,0,null,null,[])],
  ]});
  assert.deepEqual(ties.systems,[
    {systemId:6,chainIndexes:[0],mainstemIndex:0,bounds:[-180,-90,180,90]},
    {systemId:19,chainIndexes:[1],mainstemIndex:1,bounds:[0,0,0,0]},
  ]);
  assert.deepEqual(ties.fragments,[[[3],[4]],[[19]]]);
});

function scenario(name) {
  const input=fixture();
  if(name==='original-mismatch') input.raw[1].end=[.9,0];
  if(name==='border-conflict') input.parts[1][0].aligned=true;
  if(name==='long-gap') input.parts[2][0].points[0]=[1.5,0];
  if(name==='system-mismatch') input.parts[3][0].system='other';
  if(name==='split-reach') input.parts[2]=[
    {fid:2,part:1,points:[[1.5,0],[2,0]],aligned:true,system:'10'},
    {fid:2,part:0,points:[[1.002,0],[1.5,0]],aligned:true,system:'10'}];
  if(name==='region-gate') input.region='as';
  if(name==='microdegree') input.parts[2][0].points[0]=[1.000001,0];
  if(name==='upstream-aligned'){input.parts[1][0].aligned=true;input.parts[2][0].aligned=false;}
  if(name==='natural-terminal') input.raw[1].next=0;
  if(name==='missing-downstream') input.raw[1].next=999;
  if(name==='connected') input.parts[2][0].points[0]=[1,0];
  if(name==='ambiguous') input.parts[2].push({fid:2,part:1,points:[[3,0],[4,0]],aligned:false,system:'10'});
  return input;
}
nativeTest('native audits match all frozen original Python junction scenarios',async()=>{
  const oracle=JSON.parse(await readFile('tests/fixtures/hydro-connectivity-audit-oracle.json','utf8'));
  for(const name of ['baseline','original-mismatch','border-conflict','long-gap','system-mismatch',
    'split-reach','missing-downstream','connected','ambiguous']){
    const input=scenario(name),actual=run({...input,mode:'audit',sourceOrder:[1,2,3]}),expected=structuredClone(oracle[name]);
    assert.deepEqual(actual.regions,expected.regions,name);assert.equal(actual.issues.length,expected.issues.length,name);
    for(let i=0;i<actual.issues.length;i++){
      for(const key of ['gapM','originalGapM']) if(key in expected.issues[i]){
        assert.ok(Math.abs(actual.issues[i][key]-expected.issues[i][key])<1e-6,`${name} ${key}`);
        delete actual.issues[i][key];delete expected.issues[i][key];
      }
      assert.deepEqual(actual.issues[i],expected.issues[i],name);
    }
  }
});
nativeTest('native repairs match all frozen original Python junction scenarios and are idempotent',async()=>{
  const oracle=JSON.parse(await readFile('tests/fixtures/hydro-connectivity-repair-oracle.json','utf8'));
  for(const name of ['baseline','original-mismatch','border-conflict','long-gap','system-mismatch',
    'split-reach','region-gate','microdegree','upstream-aligned','natural-terminal']){
    const input=scenario(name),before=structuredClone(input),actual=run(input);
    assert.deepEqual(actual.parts,oracle[name].parts,name);assert.deepEqual(actual.changes,oracle[name].changes,name);
    assert.deepEqual(input,before,name);assert.deepEqual(run({...input,parts:actual.parts}).changes,[],name);
  }
});

nativeTest('converging tributaries share one aligned downstream port', () => {
  const input = fixture(), untouched = structuredClone(input);
  const result = run(input);
  assert.equal(result.changes.length, 2);
  assert.deepEqual(result.parts['1'][0].points.at(-1), [1.002, 0]);
  assert.deepEqual(result.parts['3'][0].points.at(-1), [1.002, 0]);
  assert.deepEqual(result.parts['2'][0].points[0], [1.002, 0]);
  assert.deepEqual(result.changes.map(row => row.fid), [1, 3]);
  assert.deepEqual(result.changes.map(row => row.sources), [[1, 3], [1, 3]]);
  assert.deepEqual(input, untouched);
  assert.deepEqual(run({ ...input, parts: result.parts }).changes, []);
});
nativeTest('aligned upstream anchor moves non-aligned downstream entry', () => {
  const input = fixture();
  input.parts['1'][0].aligned = true;
  input.parts['2'][0].aligned = false;
  const result = run(input);
  assert.deepEqual(result.parts['2'][0].points[0], [1, 0]);
  assert.deepEqual(result.parts['1'][0].points.at(-1), [1, 0]);
  assert.equal(result.changes.length, 1);
});
nativeTest('mismatched originals, conflicting border anchors, long gaps and systems never repair', () => {
  for (const mode of ['source', 'borders', 'distance', 'system']) {
    const input = fixture();
    if (mode === 'source') input.raw['1'].end = [0.9, 0];
    if (mode === 'borders') input.parts['1'][0].aligned = true;
    if (mode === 'distance') input.parts['2'][0].points[0] = [1.5, 0];
    if (mode === 'system') input.parts['3'][0].system = 'other';
    const result = run(input);
    assert.deepEqual(result.changes, [], mode);
    assert.deepEqual(result.parts, input.parts, mode);
  }
});
nativeTest('region gate blocks accidental cross-region repair', () => {
  const input = fixture(); input.region = 'as';
  const result = run(input);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.parts, input.parts);
});
nativeTest('out-of-order split reaches retain unique entry and exit ports', () => {
  const input = fixture();
  input.parts['2'] = [
    { fid: 2, part: 1, points: [[1.5, 0], [2, 0]], aligned: true, system: '10' },
    { fid: 2, part: 0, points: [[1.002, 0], [1.5, 0]], aligned: true, system: '10' },
  ];
  const result = run(input);
  assert.equal(result.changes.length, 2);
  assert.deepEqual(result.parts['1'][0].points.at(-1), [1.002, 0]);
  assert.deepEqual(result.parts['2'][0].points[0], [1.5, 0]);
  assert.deepEqual(result.parts['2'][1].points[0], [1.002, 0]);
});
nativeTest('microdegree quantization produces exact identical confluence coordinates', () => {
  const input = fixture();
  input.parts['2'][0].points[0] = [1.000001, 0];
  const result = run(input);
  assert.deepEqual(result.parts['1'][0].points.at(-1), [1.000001, 0]);
  assert.deepEqual(result.parts['3'][0].points.at(-1), [1.000001, 0]);
});
nativeTest('collapsed downstream reach has no ambiguous connection',()=>{
  const input=fixture();input.parts[2][0].points=[[1,0],[1,0]];
  const result=run({...input,mode:'audit',sourceOrder:[1,2,3]});
  assert.deepEqual(result.issues,[]);
});
nativeTest('reject malformed source geometry instead of emitting partial output', () => {
  const input = fixture();
  input.parts['2'][0].points[0] = [181, 0];
  const result = spawnSync(native, [], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid Hydro coordinate/);
  assert.equal(result.stdout, '');
});
nativeTest('audit classifies source-proven gaps without changing their geometry', () => {
  const input=fixture(),before=structuredClone(input),result=run({...input,mode:'audit',sourceOrder:[1,2,3]});
  assert.deepEqual(input,before);
  assert.deepEqual(result.issues.map(row=>[row.source,row.downstream,row.cause,row.repairable]),
    [[1,2,'border-alignment',true],[3,2,'border-alignment',true]]);
  assert.equal(result.regions.eu.selectedReaches,3);assert.equal(result.regions.eu.expectedConnections,2);
  assert.equal(result.regions.eu.naturalTerminals,1);assert.equal(result.regions.eu.repairable,2);
  assert.deepEqual(result.regions.as,{});
  const mismatch=fixture();mismatch.raw[1].end=[.9,0];
  const changed=run({...mismatch,mode:'audit',sourceOrder:[1,2,3]});
  assert.equal(changed.issues[0].cause,'original-mismatch');assert.equal(changed.issues[0].repairable,false);
  for(const sourceOrder of [[1,2],[1,2,2],[1,2,3,4]]){
    const rejected=spawnSync(native,[],{input:JSON.stringify({...input,mode:'audit',sourceOrder}),encoding:'utf8'});
    assert.equal(rejected.status,1);assert.match(rejected.stderr,/source order/i);assert.equal(rejected.stdout,'');
  }
});
test('audit result validation rejects inconsistent source identities and counts',()=>{
  const input=fixture(),result={regions:Object.fromEntries(['eu','as','si','af','sa','na','ar','au','gr'].map(id=>[id,{}])),issues:[]};
  result.regions.eu={selectedReaches:3,expectedConnections:2,naturalTerminals:1,connected:2};
  validateHydroAudit(result,{...input,sourceOrder:[1,2,3]});
  const invalid=structuredClone(result);invalid.issues.push({region:'eu',source:99,downstream:2,cause:'missing-downstream',repairable:false});
  assert.throws(()=>validateHydroAudit(invalid,{...input,sourceOrder:[1,2,3]}),/audit/i);
  invalid.issues=[];invalid.regions.eu.issues=2;
  assert.throws(()=>validateHydroAudit(invalid,{...input,sourceOrder:[1,2,3]}),/audit/i);
  delete invalid.regions.eu.issues;invalid.regions.eu.selectedReaches=2;
  assert.throws(()=>validateHydroAudit(invalid,{...input,sourceOrder:[1,2,3]}),/audit/i);
});
test('feature source mapping retains split reaches and does not mutate original geometry',()=>{
  const features=[{metadata:{category:'river',sourceId:'1,2',fid:10,flags:1,systemId:'s'},
    geometry:{type:'MultiLineString',coordinates:[[[0,0],[1,0]],[[1,0],[2,0]]]}},
    {metadata:{category:'lake'},geometry:{type:'Polygon',coordinates:[]}}];
  const original=structuredClone(features),parts=hydroPartsBySource(features);
  assert.deepEqual(parts['1'][0],{fid:10,part:0,points:[[0,0],[1,0]],aligned:true,system:'s'});
  assert.deepEqual(parts['2'][0].points,[[1,0],[2,0]]);parts['1'][0].points[0][0]=9;
  assert.deepEqual(features,original);
  features[0].metadata.sourceId='1';assert.throws(()=>hydroPartsBySource(features),/mapping/i);
});
test('repair result validation rejects unreported and interior changes',()=>{
  const input=fixture(),result={parts:structuredClone(input.parts),changes:[]};
  validateHydroRepair(result,input);
  result.parts['1'][0].points[1]=[1.001,0];assert.throws(()=>validateHydroRepair(result,input),/receipt/i);
  result.parts['1'][0].points=[[0,0],[.5,0],[1,0]];
  assert.throws(()=>validateHydroRepair(result,input),/geometry/i);
  input.parts['1'][0].points=[[0,0],[.5,0],[1,0]];result.parts=structuredClone(input.parts);
  result.parts['1'][0].points[1]=[.6,0];assert.throws(()=>validateHydroRepair(result,input),/interior/i);
  result.parts=structuredClone(input.parts);result.parts['1'][0].system='other';
  assert.throws(()=>validateHydroRepair(result,input),/metadata/i);
});
test('regional repair planning preserves inputs and verifies every changed endpoint',{
  skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,
},async()=>{
  const input=fixture(),features=Object.values(input.parts).map(([row])=>({
    metadata:{category:'river',sourceId:String(row.fid),fid:row.fid,flags:row.aligned?1:0,systemId:row.system,
      ...(row.fid===1?{terminal:{renderEndpoint:row.points.at(-1)}}:{})},
    geometry:{type:'LineString',coordinates:row.points}}));
  const original=structuredClone(features),request={features,raw:input.raw,sourceOrder:[1,2,3]};
  const result=await planHydroFeatureRepairs(request,{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
  assert.deepEqual(features,original);assert.deepEqual(result.changedFeatureIds,[1,3]);
  assert.deepEqual(result.features[0].geometry.coordinates.at(-1),[1.002,0]);
  assert.deepEqual(result.features[0].metadata.terminal.renderEndpoint,[1.002,0]);
  assert.equal(result.unchangedFeatureCount,1);assert.equal(result.remaining.length,0);
  assert.equal(result.baselineRegions.eu.repairable,2);assert.equal(result.regions.eu.issues||0,0);
});
test('source-bound Node audit runs the verified native engine',{
  skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,
},async()=>{
  const input={...fixture(),sourceOrder:[1,2,3]};
  const result=await auditHydroParts(input,{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
  assert.deepEqual(result.issues.map(row=>row.source),[1,3]);assert.equal(result.regions.eu.repairable,2);
  const before=structuredClone(input),repair=await repairHydroParts(input,{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
  assert.deepEqual(repair.parts['1'][0].points.at(-1),[1.002,0]);assert.equal(repair.changes.length,2);assert.deepEqual(input,before);
  const specification=JSON.parse(await readFile('tests/fixtures/hydro-source/spec.json','utf8'));
  const features=[{metadata:{category:'river',sourceId:'101',fid:1,flags:0,systemId:'s',bounds:[0,0,1000000,0]},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}},
    {metadata:{category:'river',sourceId:'102',fid:2,flags:0,systemId:'s'},geometry:{type:'LineString',coordinates:[[1,0],[2,0]]}},
    {metadata:{category:'river',sourceId:'103',fid:3,flags:0,systemId:'s'},geometry:{type:'LineString',coordinates:[[0,1],[1,0]]}}];
  const frozen=structuredClone(features),archives=[{archive:'tests/fixtures/hydro-source/fixture.zip',specification,selected:new Set([103,101,102])}];
  const fromArchive=await auditHydroSourceArchives({features,archives},{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
  assert.deepEqual(fromArchive.issues,[]);assert.equal(fromArchive.regions.eu.connected,2);assert.deepEqual(features,frozen);
  const baseline={features:structuredClone(features)};baseline.features[0].geometry.coordinates[1]=[.999,0];
  const staged={features:structuredClone(features)},report={changes:[{fid:1,part:0,index:-1,before:[.999,0],after:[1,0]}],changedFeatureIds:[1],unchangedFeatureCount:2,remaining:[]};
  const request={baseline,staged,report,archives},options={directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY};
  const verification=await verifyHydroStaged(request,options);
  assert.equal(verification.features,3);assert.equal(verification.unchangedFeatures,2);assert.equal(verification.remaining,0);
  const planned=await planHydroSourceRepairs({features:baseline.features,archives:[{archive:archives[0].archive,specification}]},options);
  assert.deepEqual(planned.changedFeatureIds,[1]);assert.deepEqual(planned.features[0].geometry.coordinates.at(-1),[1,0]);
  assert.equal((await verifyHydroStaged({baseline,staged:{features:planned.features},report:planned,archives},options)).remaining,0);
  delete staged.features[0].metadata.bounds;await assert.rejects(verifyHydroStaged(request,options),/bounds/i);
  staged.features[0].metadata.bounds=[0,0,1000000,0];
  staged.features[2].geometry.coordinates[0]=[0,2];await assert.rejects(verifyHydroStaged(request,options),/geometry/i);
  staged.features[2].geometry.coordinates[0]=[0,1];staged.features[1].widths=[2];await assert.rejects(verifyHydroStaged(request,options),/width/i);
});
