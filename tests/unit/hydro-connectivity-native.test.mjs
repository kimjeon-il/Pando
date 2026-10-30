import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {auditHydroParts,auditHydroSourceArchives,hydroPartsBySource,repairHydroParts,validateHydroAudit,validateHydroRepair,verifyHydroStaged} from '../../tools/gis/hydro-connectivity-native.mjs';
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
  delete staged.features[0].metadata.bounds;await assert.rejects(verifyHydroStaged(request,options),/bounds/i);
  staged.features[0].metadata.bounds=[0,0,1000000,0];
  staged.features[2].geometry.coordinates[0]=[0,2];await assert.rejects(verifyHydroStaged(request,options),/geometry/i);
  staged.features[2].geometry.coordinates[0]=[0,1];staged.features[1].widths=[2];await assert.rejects(verifyHydroStaged(request,options),/width/i);
});
