import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compareNaturalEarthMainstems, naturalEarthHydronym,
  pointToLineDistance, pythonRound, runNaturalEarthScreen } from '../../tools/gis/compare-osm-hydro-natural-earth.mjs';

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
test('published microdegree bounds match Python binary64 tie-side rounding',()=>{
  const cases=[
    [1000050,1.0001],[-12345550,-12.3455],
    [9876550,9.8765],[10234550,10.2346],
  ];
  for(const [micro,expected] of cases)
    assert.equal(pythonRound(micro/1e6,4),expected,'microdegree '+micro);
  const raw=decoded(),sourceBefore=structuredClone(raw);
  raw.features[0].metadata.bounds=[1000050,-12345550,9876550,10234550];
  const proof=compareNaturalEarthMainstems(raw,ne(),scope());
  assert.deepEqual(proof.items[0].mainstemBounds,[1.0001,-12.3455,9.8765,10.2346]);
  assert.deepEqual(sourceBefore,decoded());
});
test('published Hydro system 20532766 preserves its three source mainstem fragments and exact Python bbox',()=>{
  // SHA-verified Hydro v0.13.2: f0832dd2...; metadata core: 048449cc...
  // The raw latitude 43.243750 is represented just below its decimal tie in binary64.
  const bounds=[
    [42431250,43243750,45000000,43600000],
    [44000000,43400000,46800000,43781250],
    [46000000,43600000,47552083,43700000],
  ];
  const chains=[
    [[42.43125,43.24375],[44.9,43.6]],
    [[44,43.4],[46.8,43.78125]],
    [[46,43.6],[47.552083,43.7]],
  ];
  const decodedSource={features:chains.map((coordinates,i)=>({
    metadata:{systemId:'20532766',role:'mainstem',bounds:bounds[i]},
    geometry:{type:'LineString',coordinates},
  }))};
  const inputBefore=structuredClone(decodedSource);
  const result=compareNaturalEarthMainstems(decodedSource,ne(),{
    items:[{systemId:'20532766',nameKo:'source-name'}],
  });
  assert.equal(result.items[0].mainstemFragments,3);
  assert.deepEqual(result.items[0].mainstemBounds,[42.4312,43.2437,47.5521,43.7812]);
  assert.equal(pythonRound(43243750/1e6,4),43.2437);
  assert.deepEqual(decodedSource,inputBefore);
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
test('CLI emits the reviewed per-system rows needed by existing audit consumers',t=>{
  const dir=mkdtempSync(join(tmpdir(),'hydro-ne-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=join(dir,'ne.json'),geo=join(dir,'decoded.json'),review=join(dir,'review.json'),output=join(dir,'output.json');
  writeFileSync(source,JSON.stringify(ne()));writeFileSync(geo,JSON.stringify(decoded()));writeFileSync(review,JSON.stringify(scope()));
  const cli=fileURLToPath(new URL('../../tools/gis/compare-osm-hydro-natural-earth.mjs',import.meta.url));
  const stdout=execFileSync(process.execPath,[cli,'--decoded',geo,'--natural-earth',source,'--expected-sha256',hash(readFileSync(source)),'--inventory',review,'--output',output],{encoding:'utf8'});
  const row=stdout.split(/\r?\n/).find(line=>line.startsWith('OSM_NE_ROW='));
  assert.ok(row);assert.equal(JSON.parse(row.slice('OSM_NE_ROW='.length)).systemId,'42');
});
