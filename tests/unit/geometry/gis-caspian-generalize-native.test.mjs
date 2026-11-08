import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const water={type:'Polygon',coordinates:[[
  [48,42],[49,42],[49,43],[48,43],[48,42],
]]};
const edge=(coordinates,i,role='NOT_COAST')=>({
  type:'Feature',id:'reach-'+i,
  properties:{hybrid_id:'original-'+i,hybrid_role:role,simplification_m:0},
  geometry:{type:'LineString',coordinates},
});
const edges=(role='NOT_COAST')=>[
  edge([[48,42],[49,42]],0,role),
  edge([[49,42],[49,43]],1,role),
  edge([[49,43],[48,43]],2,role),
  edge([[48,43],[48,42]],3,role),
];
const input=(features=edges())=>({
  network:{type:'FeatureCollection',features},
  water,expectedHoles:0,
});
function run(t,document){
  assert.ok(binary,'Native GEOS/PROJ recipe binary required');
  const dir=mkdtempSync(join(tmpdir(),'gis-caspian-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const request=join(dir,'input.json'),result=join(dir,'answer.json');
  writeFileSync(request,JSON.stringify(document));
  const before=readFileSync(request);
  const proc=spawnSync(binary,['--generalize-caspian',request,result],
    {encoding:'utf8',maxBuffer:4*1024*1024});
  assert.deepEqual(readFileSync(request),before,'Historical original must not mutate');
  return {proc,result,answer:proc.status===0?JSON.parse(readFileSync(result,'utf8')):null};
}
test('native protected boundary preserves every role, original endpoint and the water polygon',t=>{
  const original=input(),before=structuredClone(original);
  const {proc,answer}=run(t,original);
  assert.equal(proc.status,0,proc.stderr);
  assert.deepEqual(original,before);
  assert.equal(answer.metrics.holesBefore,0);
  assert.equal(answer.metrics.holesAfter,0);
  assert.equal(answer.metrics.nonEndpointIntersections,0);
  assert.equal(answer.metrics.adaptiveLocalRepairs,0);
  assert.equal(answer.metrics.verticesAfter,answer.metrics.verticesBefore);
  assert.equal(answer.metrics.perFeatureToleranceMeters.length,4);
  for(let i=0;i<4;++i){
    assert.deepEqual(answer.network.features[i].properties,original.network.features[i].properties);
    assert.deepEqual(answer.network.features[i].geometry,original.network.features[i].geometry);
    assert.equal(answer.metrics.perFeatureToleranceMeters[i].tolerance,0);
  }
  assert.equal(answer.water.type,'MultiPolygon');
  assert.equal(answer.water.coordinates.length,1);
});
test('native protected/movable reaches simplify only display derivatives',t=>{
  const jagged=[
    edge([[48,42],[48.2,42.0002],[48.4,42],[48.6,42.0002],[49,42]],0,'COAST'),
    ...edges().slice(1),
  ];
  const {proc,answer}=run(t,input(jagged));
  assert.equal(proc.status,0,proc.stderr);
  assert.ok(answer.metrics.verticesAfter<answer.metrics.verticesBefore,
    'Only non-protected small display bends should disappear');
  const altered=answer.network.features[0].geometry.coordinates;
  assert.deepEqual(altered[0],[48,42]);
  assert.deepEqual(altered.at(-1),[49,42]);
  assert.deepEqual(answer.network.features[1].geometry.coordinates,[[49,42],[49,43]]);
  assert.ok(answer.metrics.perFeatureToleranceMeters[0].tolerance>0);
  assert.equal(answer.metrics.holesAfter,0);
});
test('no allowed simplification may hide an actual interior crossing',t=>{
  const crossing=[...edges(),edge([[48,42.5],[49,42.5]],4)];
  const {proc}=run(t,input(crossing));
  assert.notEqual(proc.status,0);
  assert.match(proc.stderr,/cannot preserve approved topology/);
});
test('native generalizer must not overwrite an earlier result',t=>{
  const dir=mkdtempSync(join(tmpdir(),'gis-caspian-existing-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const inputFile=join(dir,'input.json'),existing=join(dir,'already.json');
  writeFileSync(inputFile,JSON.stringify(input()));
  writeFileSync(existing,'Protected earlier result');
  const proc=spawnSync(binary,['--generalize-caspian',inputFile,existing],{encoding:'utf8'});
  assert.notEqual(proc.status,0);
  assert.match(proc.stderr,/Refusing to replace prior Caspian result/);
  assert.equal(readFileSync(existing,'utf8'),'Protected earlier result');
});
