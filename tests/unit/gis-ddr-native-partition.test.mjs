import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  immutableDDRRecord,canonicalGermanCountry,validatePartitionProof,LIMITS,
} from '../../tools/gis/verify-east-germany-partition.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const box=(x0,y0,x1,y1)=>({type:'MultiPolygon',coordinates:[
  [[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]
]});
const fake=()=>({
  entityId:'state:deutsche-demokratische-republik',
  names:{en:'German Democratic Republic',ko:'독일 민주공화국',de:'Deutsche Demokratische Republik'},
  alternateNames:['동독','East Germany','DDR','GDR','Ostdeutschland'],
  lifetime:{validFrom:'1949-10-07',validTo:'1990-10-02'},
  metadata:{dissolutionDate:'1990-10-03',referenceDate:'1989-04-25'},
  instantiation:{mode:'territory-replacement',countryUpdates:{DEU:{name:'독일 연방공화국'}}},
  geometryVersions:[{versionId:'1989',geometry:box(10,50,12,51)}],
});
const acceptedProof=()=>({schemaVersion:1,passed:true,areaKm2:108500,outsideKm2:0,
  overlapKm2:0,puzzleDifferenceKm2:0,sharedVertexCount:10,
  sharedVerticesFromCanonical:true});
function run(t,candidate,canonical,limits){
  assert.ok(binary,'Expected compiled C++ GEOS/PROJ country recipe engine');
  const dir=mkdtempSync(join(tmpdir(),'ddr-geos-partition-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'request.json'),json=JSON.stringify({candidate,canonical,limits});
  writeFileSync(file,json);
  const proc=spawnSync(binary,['--audit-partition',file],{encoding:'utf8'});
  assert.equal(proc.status,0,proc.stderr);
  assert.equal(readFileSync(file,'utf8'),json);
  return JSON.parse(proc.stdout);
}
test('DDR identity, lifetime, alternate names and 1989 territory replacement remain frozen',()=>{
  const entity=fake(),geometry=immutableDDRRecord(entity);
  assert.deepEqual(geometry,entity.geometryVersions[0].geometry);
  entity.lifetime.validFrom='1948-05-23';
  assert.throws(()=>immutableDDRRecord(entity),/legal dates changed/);
  const world={type:'FeatureCollection',features:[{id:'DEU',geometry:box(10,50,12,51)}]};
  assert.deepEqual(canonicalGermanCountry(world),world.features[0].geometry);
  assert.throws(()=>canonicalGermanCountry({type:'FeatureCollection',features:[]}),/Exactly one/);
});
test('Native GEOS canonical partition verifies exact shared boundary and non-mutating source',t=>{
 const reference=box(10,50,12,51);
 const report=run(t,reference,reference,{
  minimumAreaKm2:1,maximumAreaKm2:1000000,
  maximumOutsideKm2:1e-6,maximumOverlapKm2:.001,maximumPuzzleKm2:.001,
 });
 assert.equal(report.passed,true);
 assert.equal(report.sharedVerticesFromCanonical,true);
 assert.ok(report.sharedVertexCount>0);
 assert.ok(report.outsideKm2<=1e-6);
});
test('Native GEOS rejects territory extending outside the historic canonical national geometry',t=>{
 const reference=box(10,50,12,51);
 const changed=box(9.5,50,12,51);
 const metrics=run(t,changed,reference,{
  minimumAreaKm2:1,maximumAreaKm2:1000000,
  maximumOutsideKm2:1e-6,maximumOverlapKm2:.001,maximumPuzzleKm2:.001,
 });
 assert.equal(metrics.passed,false);
 assert.ok(metrics.outsideKm2>1);
});
test('Node enforces original 1989 DDR area and shared-vertex limits instead of widening approvals',()=>{
 const accepted=acceptedProof();
 assert.deepEqual(validatePartitionProof(accepted),accepted);
 for(const mutate of [
  p=>p.areaKm2=LIMITS.maximumAreaKm2+1,
  p=>p.outsideKm2=LIMITS.maximumOutsideKm2+0.01,
  p=>p.sharedVerticesFromCanonical=false,
  p=>p.sharedVertexCount=0,
  p=>p.puzzleDifferenceKm2=LIMITS.maximumPuzzleKm2+0.01,
 ]){
   const proof=acceptedProof();mutate(proof);
   assert.throws(()=>validatePartitionProof(proof),/reviewed German source partition|area budgets/);
 }
});
