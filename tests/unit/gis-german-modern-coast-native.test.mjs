import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const fixture=JSON.parse(readFileSync(new URL('../fixtures/german-modern-coast-oracle.json',import.meta.url),'utf8'));
function native(input){
  const p=spawnSync(binary,['--german-1914-modern-coast','-'],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});
  if(p.error)throw p.error;
  if(p.status!==0)throw Error(p.stderr);
  return JSON.parse(p.stdout);
}
test('German modern coast matches the frozen Python geometry and diagnostics',()=>{
  assert.ok(binary,'PANDO_TERRITORIAL_RECIPE_BINARY is required');
  const {input,expected}=fixture,result=native(input);
  for(const key of ['outsideKm2','areaKm2','historicalAreaKm2','changedKm2','helgolandKm2','duneKm2'])
    assert.ok(Math.abs(result[key]-expected[key])<0.0001,`${key}: ${result[key]} vs ${expected[key]}`);
  assert.deepEqual(result.controls,expected.controls);
  assert.equal(result.valid,true);
  assert.equal(result.geographicValid,true);
  assert.equal(result.geographicRepaired,false);
  const dir=mkdtempSync(join(tmpdir(),'pando-coast-'));
  try{
    const path=join(dir,'comparison.json');
    writeFileSync(path,JSON.stringify({approved:expected.geometry,published:result.geometry}));
    const p=spawnSync(binary,['--compare-historical-geometry',path],{encoding:'utf8',windowsHide:true});
    assert.equal(p.status,0,p.stderr);
    const diff=JSON.parse(p.stdout);
    assert.ok(diff.symmetricDifferenceSquareDegrees<1e-9,JSON.stringify(diff));
    assert.ok(diff.boundaryHausdorffDegrees<1e-7,JSON.stringify(diff));
  }finally{rmSync(dir,{recursive:true});}
});
test('German modern coast rejects a failed control point and unsafe inland change',()=>{
  const wrong=structuredClone(fixture.input);wrong.controls[0].expected=false;
  assert.throws(()=>native(wrong),/control point failed/i);
  const inland=structuredClone(fixture.input);
  inland.helgoland={type:'Polygon',coordinates:[[[10,54],[10.01,54],[10.01,54.01],[10,54.01],[10,54]]]};
  assert.throws(()=>native(inland),/inland geometry changed/i);
});
test('selected original modern coast repairs geographic topology within one centimetre',
  {skip:!process.env.PANDO_GERMAN_COAST_SELECTED_ORACLE},()=>{
    const selected=JSON.parse(readFileSync(process.env.PANDO_GERMAN_COAST_SELECTED_ORACLE,'utf8'));
    const actual=native(selected.input);
    assert.equal(actual.valid,true);
    assert.equal(actual.geographicValid,true);
    assert.equal(actual.geographicRepaired,true);
    assert.ok(actual.repairBoundaryDistanceMetres<0.01);
    assert.deepEqual(actual.controls,selected.expected.controls);
    assert.ok(Math.abs(actual.areaKm2-selected.expected.areaKm2)<0.0001);
    assert.ok(Math.abs(actual.changedKm2-selected.expected.changedKm2)<0.0001);
  });
