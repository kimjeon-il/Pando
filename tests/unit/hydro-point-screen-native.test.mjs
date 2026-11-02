import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {findHydroReferenceGuides,scoreHydroGuidedBranches,selectHydroUpstreams} from '../../tools/gis/hydro-point-screen-native.mjs';

const binary=process.env.PANDO_HYDRO_POINT_SCREEN_BINARY;
const fixture={crs:'EPSG:32632',lines:[[[9,0],[9,1]],[[9.2,0],[9.2,1]]],points:[[9,0],[9.1,0.5],[9.19,0.5]]};
function invoke(value){
  assert.ok(binary,'PANDO_HYDRO_POINT_SCREEN_BINARY must name the native test tool');
  return spawnSync(binary,[],{input:JSON.stringify(value),encoding:'utf8',maxBuffer:16*1024*1024});
}
test('guided branch scores preserve distance and upstream orientation',{skip:!binary},()=>{
  const current=[[0,0],[1,0]],reference=[[-1,0],[1,0]];
  for(const [candidate,score,alignment] of [
    [[[0,0],[-1,0]],0,1],
    [[[0,0],[0,1]],.04,0],
    [[[0,.1],[0,1]],.14,0],
    [[[-1,0],[0,0]],0,1],
  ]){
    const result=invoke({mode:'guided-branch',current,candidate,reference});assert.equal(result.status,0,result.stderr);
    const actual=JSON.parse(result.stdout);assert.ok(Math.abs(actual.score-score)<1e-12);assert.ok(Math.abs(actual.alignment-alignment)<1e-12);
  }
});
test('guided branch scores handle zero direction and reject malformed geometry',{skip:!binary},()=>{
  const request={mode:'guided-branch',current:[[0,0],[1,0]],candidate:[[0,0],[-1,0]],reference:[[0,0],[0,0]]};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);
  const score=JSON.parse(result.stdout);assert.ok(Math.abs(score.alignment)<1e-12);assert.equal(score.score,.04);
  for(const input of [{...request,reference:[[0,0]]},{...request,candidate:[[181,0],[0,0]]}]){
    const failed=invoke(input);assert.notEqual(failed.status,0);assert.equal(failed.stdout,'');
  }
});
test('canonical upstream selection preserves basin, guide threshold and deterministic ties',{skip:!binary},()=>{
  const row=(id,basin,area,flow,order,score=null,alignment=null)=>({id,basin,area,flow,order,score,alignment});
  const cases=[
    {candidates:[row(1,7,10,2,1),row(2,8,100,9,5)],basin:7,id:1},
    {candidates:[row(1,7,10,2,1),row(2,7,10,2,1)],basin:7,id:2},
    {candidates:[row(1,7,100,2,1,.05,.5),row(2,7,20,1,1,.01,.2),row(3,7,9,9,9,0,1)],basin:7,id:2},
    {candidates:[row(1,7,100,2,1,.17,1),row(2,7,20,1,1,.18,1)],basin:7,id:1},
    {candidates:[row(1,7,100,2,1,.16,.5),row(2,7,20,1,1,.16,.7)],basin:7,id:2},
    {candidates:[row(1,7,-2,-5,1,0,1),row(2,7,-1,-4,1,.01,1)],basin:7,id:2},
  ];
  for(const {basin,candidates,id} of cases){const result=invoke({mode:'canonical-upstream',basin,candidates});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).id,id);}
  const tied=[row(1,7,10,2,3),row(2,7,10,2,1)];
  assert.equal(JSON.parse(invoke({mode:'canonical-upstream',basin:7,candidates:tied}).stdout).id,1);
  assert.equal(JSON.parse(invoke({mode:'guided-upstream',basin:7,candidates:tied}).stdout).id,2);
  const invalid=invoke({mode:'canonical-upstream',basin:7,candidates:[]});assert.notEqual(invalid.status,0);
});
test('batched guided geometry and canonical decisions match individual native calls',{skip:!binary},()=>{
  const branches=[{current:[[0,0],[1,0]],candidate:[[0,0],[-1,0]],reference:[[-1,0],[1,0]]},
    {current:[[0,0],[1,0]],candidate:[[0,0],[0,1]],reference:[[-1,0],[1,0]]}];
  let batch=invoke({mode:'guided-branches',branches});assert.equal(batch.status,0,batch.stderr);
  assert.deepEqual(JSON.parse(batch.stdout).branches,branches.map(branch=>JSON.parse(invoke({mode:'guided-branch',...branch}).stdout)));
  const row=(id,area,score,alignment)=>({id,basin:7,area,flow:1,order:2,score,alignment});
  const groups=[{basin:7,candidates:[row(1,10,0,1),row(2,8,.04,0)]},{basin:7,candidates:[row(3,4,null,null)]}];
  batch=invoke({mode:'canonical-upstreams',groups});assert.equal(batch.status,0,batch.stderr);
  assert.deepEqual(JSON.parse(batch.stdout).groups,groups.map(group=>JSON.parse(invoke({mode:'canonical-upstream',...group}).stdout)));
  const invalid=invoke({mode:'guided-branches',branches:[branches[0],{...branches[1],current:[[0,0]]}]});
  assert.notEqual(invalid.status,0);assert.equal(invalid.stdout,'');
});
test('nearest geographic reference selects only lines inside the requested guide distance',{skip:!binary},()=>{
  const request={mode:'reference-guides',references:[[[0,0],[1,0]],[[0,2],[1,2]]],
    queries:[[[0,.1],[1,.1]],[[0,2.05],[1,2.05]],[[0,1],[1,1]],[]],maxDistance:.22};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);const {matches}=JSON.parse(result.stdout);
  assert.equal(matches[0].index,0);assert.ok(Math.abs(matches[0].distance-.1)<1e-12);
  assert.equal(matches[1].index,1);assert.ok(Math.abs(matches[1].distance-.05)<1e-12);
  assert.deepEqual(matches.slice(2),[null,null]);
  const empty=invoke({...request,references:[]});assert.equal(empty.status,0,empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout).matches,[null,null,null,null]);
  const invalid=invoke({...request,queries:[[[181,0],[0,0]]]});assert.notEqual(invalid.status,0);assert.equal(invalid.stdout,'');
});
test('source-bound guided branch and upstream batches return ordered native decisions',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const branches=[{current:[[0,0],[1,0]],candidate:[[0,0],[-1,0]],reference:[[-1,0],[1,0]]},
      {current:[[0,0],[1,0]],candidate:[[0,0],[0,1]],reference:[[-1,0],[1,0]]}];
    const scores=await scoreHydroGuidedBranches(branches,options);
    assert.deepEqual(scores,[{score:0,alignment:1},{score:0.04,alignment:0}]);
    const candidates=scores.map((value,i)=>({id:i+1,basin:7,area:10,flow:1,order:1,...value}));
    assert.deepEqual(await selectHydroUpstreams([{basin:7,candidates}],{...options,kind:'canonical'}),[1]);
    await assert.rejects(selectHydroUpstreams([{basin:7,candidates:[]}],{...options,kind:'canonical'}),/candidate|upstream/i);
  });
test('source-bound reference guides retain their source index and threshold',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const references=[[[0,0],[1,0]],[[0,2],[1,2]]],queries=[[[0,.1],[1,.1]],[[0,1],[1,1]],[]];
    const matches=await findHydroReferenceGuides({references,queries,maxDistance:.22},options);
    assert.equal(matches[0].index,0);assert.ok(Math.abs(matches[0].distance-.1)<1e-12);assert.deepEqual(matches.slice(1),[null,null]);
    assert.deepEqual(await findHydroReferenceGuides({references:[],queries,maxDistance:.22},options),[null,null,null]);
    await assert.rejects(findHydroReferenceGuides({references,queries,maxDistance:-1},options),/reference/i);
  });
test('native point screen computes projected lengths and closest points',{skip:!binary},()=>{
  const output=invoke(fixture);assert.equal(output.status,0,output.stderr);
  const result=JSON.parse(output.stdout);assert.equal(result.points.length,3);assert.equal(result.lineLengthsMeters.length,2);
  assert.ok(result.lineLengthsMeters.every(x=>x>110000&&x<111000));
  assert.ok(result.points[0].distanceMeters<1e-6);
  assert.ok(result.points[1].distanceMeters>10000&&result.points[1].distanceMeters<12000);
  assert.ok(result.points[2].distanceMeters>1000&&result.points[2].distanceMeters<1200);
  assert.ok(Math.abs(result.points[2].nearestLonLat[0]-9.199992435555043)<1e-8);
  assert.ok(Math.abs(result.points[2].nearestLonLat[1]-0.500000007662718)<1e-8);
});
test('native point screen rejects invalid CRS and coordinates without partial output',{skip:!binary},()=>{
  for(const input of [{...fixture,crs:'EPSG:4326'}, {...fixture,points:[[181,0]]},{...fixture,lines:[[[9,0]]]},{...fixture,mode:'unknown'}]){
    const result=invoke(input);assert.notEqual(result.status,0);assert.equal(result.stdout,'');
  }
});
test('native point screen supports independent input parts for batch audits',{skip:!binary},()=>{
  const result=invoke({...fixture,mode:'parts',lines:[...fixture.lines,[[9,0],[9,0]]]});assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.equal(output.points.length,3);
  assert.equal(output.lineLengthsMeters.length,2);
  assert.ok(Math.abs(output.points[2].nearestLonLat[0]-9.199992435555043)<1e-8);
});
test('native point screen reports line lengths when a system has no external points',{skip:!binary},()=>{
  const result=invoke({...fixture,mode:'parts',points:[]});assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.deepEqual(output.points,[]);assert.equal(output.lineLengthsMeters.length,2);
});
test('native point screen supports indexed nearest-line searches',{skip:!binary},()=>{
  const result=invoke({...fixture,mode:'tree'});assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.equal(output.points.length,3);
  assert.ok(Math.abs(output.points[2].nearestLonLat[0]-9.199992435555043)<1e-8);
});
test('native vector screen compares both directions in projected coordinates',{skip:!binary},()=>{
  const line=[[145,-37.8],[145.01,-37.81]],result=invoke({crs:'EPSG:32755',mode:'vector',lines:[line],referenceLines:[line],points:[],samples:5});
  assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout);
  assert.equal(output.lineLengthsMeters.length,1);assert.equal(output.referenceLengthsMeters.length,1);
  assert.equal(output.hydroToReferenceMeters.length,5);assert.equal(output.referenceToHydroMeters.length,5);
  assert.ok(output.hydroToReferenceMeters.every(value=>value<1e-6));
  assert.ok(output.referenceToHydroMeters.every(value=>value<1e-6));
  assert.equal(output.referenceBoundsMeters.length,4);
});
test('native vector screen rejects missing, invalid or degenerate source lines',{skip:!binary},()=>{
  for(const referenceLines of [[],[[[145,-37.8],[145,-37.8]]]]){
    const result=invoke({crs:'EPSG:32755',mode:'vector',lines:[[[145,-37.8],[145.01,-37.81]]],referenceLines,points:[],samples:5});
    assert.notEqual(result.status,0);assert.equal(result.stdout,'');
  }
});
