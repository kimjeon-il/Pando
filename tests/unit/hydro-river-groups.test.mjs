import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {verifyHydroRiverGroups,verifyHydroManifestPolicy} from '../../tools/gis/hydro-pack-decoder.mjs';

function sample(){return [
  {metadata:{fid:1,logicalFid:20,awId:'river:20',category:'river',stage:1,fragmentIndex:0,fragmentCount:3,role:'mainstem'},
    geometry:{type:'MultiLineString',coordinates:[[[0,0],[1,0]],[[1,0],[2,0]]]},widths:[[0.55,0.8],[0.8,1.2]]},
  {metadata:{fid:2,logicalFid:20,awId:'river:20',category:'river',stage:1,fragmentIndex:1,fragmentCount:3,role:'mainstem',terminal:{class:'sea',renderEndpoint:[3.0000002,0]}},
    geometry:{type:'LineString',coordinates:[[2,0],[3,0]]},widths:[[1.2,2.6]]},
  {metadata:{fid:3,logicalFid:20,awId:'river:20',category:'river',stage:2,fragmentIndex:2,fragmentCount:3,role:'tributary',terminal:{class:'confluence',renderEndpoint:[3,0]}},
    geometry:{type:'LineString',coordinates:[[3,1],[3,0]]},widths:[[0.7,0.9]]}
];}
test('selected complete river system preserves identity, exact chain junctions, terminals and widths',()=>{
  const rows=sample(),before=structuredClone(rows);
  assert.deepEqual(verifyHydroRiverGroups(rows),{systems:1,fragments:3,terminals:2});
  assert.deepEqual(rows,before);
  const result=spawnSync(process.execPath,['tools/gis/hydro-pack-decoder.mjs','--verify-river-groups'],{input:JSON.stringify(rows),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{systems:1,fragments:3,terminals:2});
});
test('river validation rejects incomplete systems and inconsistent identities',()=>{
  assert.throws(()=>verifyHydroRiverGroups(sample().slice(0,2)),/fragment/i);
  let rows=sample();rows[1].metadata.awId='other';assert.throws(()=>verifyHydroRiverGroups(rows),/identity/i);
  rows=sample();rows[1].metadata.fid=1;assert.throws(()=>verifyHydroRiverGroups(rows),/identity/i);
});
test('river validation checks both part and fragment continuity while allowing new terminal chains',()=>{
  let rows=sample();rows[0].geometry.coordinates[1][0]=[1,0.000001];assert.throws(()=>verifyHydroRiverGroups(rows),/part/i);
  rows=sample();rows[1].geometry.coordinates[0]=[2,0.000001];assert.throws(()=>verifyHydroRiverGroups(rows),/fragment.*connect/i);
});
test('river validation rejects missing or misplaced terminals and narrowing or invalid widths',()=>{
  let rows=sample();rows[1].metadata.terminal.class='unresolved-land';assert.throws(()=>verifyHydroRiverGroups(rows),/terminal/i);
  rows=sample();rows[1].metadata.terminal.renderEndpoint=[3.000002,0];assert.throws(()=>verifyHydroRiverGroups(rows),/terminal/i);
  rows=sample();delete rows[1].metadata.terminal;assert.throws(()=>verifyHydroRiverGroups(rows),/mainstem.*terminal/i);
  rows=sample();rows[0].widths[0]=[1,0.9];assert.throws(()=>verifyHydroRiverGroups(rows),/width/i);
  rows=sample();rows[0].widths[0]=[0.54,0.8];assert.throws(()=>verifyHydroRiverGroups(rows),/width/i);
  rows=sample();rows[0].widths.pop();assert.throws(()=>verifyHydroRiverGroups(rows),/width/i);
});

function manifestSample(){return {version:'1',schema:'pandolab-water-shards-v5',container:{sha256:'a'.repeat(64)},
  cache:{name:'pandolab-water-v1-independent-bbbbbbbbbbbbbbbb'},index:{bytes:40},metadata:{featureCount:6,core:{sha256:'b'.repeat(64)},detail:{lazy:true}},
  shards:[{bytes:40}],stats:{featureCount:6,compressedBytes:40,packCount:2,logicalFeatureCount:3,
    downstreamClosureReachCount:1,coastSnappedTerminalCount:1,mediumMainstemReachCount:1,borderAlignedLengthKm:1,terminalClassCounts:{}},
  selection:{riverThresholds:[14.4744,12.4307,11.2137,10.55],riverContinuity:'closed downstream',mediumMainstemMinBasinKm2:2500,
    terminalConnectivity:{maximumCoastExtensionKm:25,unresolvedRenderedLandTerminal:'exclude unresolved'}}};}
test('Hydro manifest keeps delivery limits and downstream selection policy',()=>{
  const manifest=manifestSample(),input={manifest,version:'1',manifestBytes:100,packCount:2,logicalCount:3};
  assert.deepEqual(verifyHydroManifestPolicy(input),{version:'1',packs:2,logicalFeatures:3});
  const wrong=structuredClone(manifest);wrong.selection.riverThresholds[0]=14;assert.throws(()=>verifyHydroManifestPolicy({...input,manifest:wrong}),/selection/i);
  const bad=structuredClone(manifest);bad.stats.terminalClassCounts['unresolved-land']=1;assert.throws(()=>verifyHydroManifestPolicy({...input,manifest:bad}),/selection/i);
  const cache=structuredClone(manifest);cache.cache.name='pandolab-water-v1-independent-aaaaaaaaaaaaaaaa';assert.throws(()=>verifyHydroManifestPolicy({...input,manifest:cache}),/metadata/i);
  assert.throws(()=>verifyHydroManifestPolicy({...input,manifestBytes:102400}),/limit/i);
  assert.throws(()=>verifyHydroManifestPolicy({...input,packCount:3}),/count/i);
});
