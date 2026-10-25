import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compareNaturalEarthMainstems, naturalEarthHydronym,
  pointToLineDistance, runNaturalEarthScreen } from '../../tools/gis/compare-osm-hydro-natural-earth.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const ne = () => ({features:[
  {geometry:{type:'LineString',coordinates:[[0,0],[1,0]]},
    properties:{name:'Alpha',name_ko:'알파강'}},
  ...Array.from({length:100},(_,index)=>({
    geometry:{type:'LineString',coordinates:[[20,10+index],[21,10+index]]},
    properties:{name:'Other '+index}})),
]});
const decoded = () => ({features:[
  {metadata:{systemId:'42',role:'mainstem',bounds:[0,0,1e6,0]},
    geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}},
]});
const scope = () => ({items:[{systemId:'42',nameKo:'원래강'}]});
test('81 independent name samples preserve support and source name without modifying Hydro geometry',()=>{
  const a=decoded(),before=structuredClone(a),result=compareNaturalEarthMainstems(a,ne(),scope());
  assert.equal(result.schema,'pando-osm-ne-crosscheck-v1');
  assert.equal(result.items.length,1);
  assert.deepEqual(result.items[0].mainstemBounds,[0,0,1,0]);
  assert.equal(result.items[0].naturalEarthCandidates[0].name,'Alpha');
  assert.equal(result.items[0].naturalEarthCandidates[0].supportingSamples,81);
  assert.equal(result.items[0].naturalEarthCandidates[0].sampleCoverage,1);
  assert.equal(result.items[0].naturalEarthCandidates[0].meanDistanceDegrees,0);
  assert.deepEqual(a,before);
});
test('single named river is counted once per location even with overlapping NE segments',()=>{
  const data=ne();
  data.features.push(structuredClone(data.features[0]));
  const result=compareNaturalEarthMainstems(decoded(),data,scope());
  assert.equal(result.items[0].naturalEarthCandidates[0].supportingSamples,81);
});
test('planar segment distance clamps the foot to endpoints',()=>{
  const segment={chain:[[0,0],[1,0]]};
  assert.equal(pointToLineDistance([0.5,0],segment),0);
  assert.equal(pointToLineDistance([0,1],segment),1);
  assert.equal(pointToLineDistance([2,0],segment),1);
  assert.deepEqual(naturalEarthHydronym({properties:{name_ko:'한글',name:'Latin'}}),
    {nameKo:'한글',name:'Latin'});
});
test('rejected missing or incomplete official reference and absent published mainstem',()=>{
  assert.throws(()=>compareNaturalEarthMainstems(decoded(),{features:[]},scope()),/incomplete/);
  assert.throws(()=>compareNaturalEarthMainstems({features:[]},ne(),scope()),/mainstem/);
});
test('CLI checks Natural Earth bytes and never overwrites input files',t=>{
  const dir=mkdtempSync(join(tmpdir(),'hydro-ne-source-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=join(dir,'ne.json'),geo=join(dir,'decoded.json'),
    review=join(dir,'inventory.json'),output=join(dir,'result.json');
  writeFileSync(source,JSON.stringify(ne()));writeFileSync(geo,JSON.stringify(decoded()));
  writeFileSync(review,JSON.stringify(scope()));
  const params=['--decoded',geo,'--natural-earth',source,'--expected-sha256',hash(readFileSync(source)),
    '--inventory',review,'--output',output];
  runNaturalEarthScreen(params);
  assert.equal(JSON.parse(readFileSync(output,'utf8')).items.length,1);
  assert.throws(()=>runNaturalEarthScreen(params),/EEXIST/);
  params[5]='0'.repeat(64);
  assert.throws(()=>runNaturalEarthScreen(params),/SHA-256/);
});
