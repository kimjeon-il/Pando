import { describe as contractSuite } from 'node:test';
import * as __hydro_dep0 from "node:assert/strict";
import * as __hydro_dep1 from "node:crypto";
import * as __hydro_dep2 from "node:child_process";
import * as __hydro_dep3 from "node:fs/promises";
import * as __hydro_dep4 from "node:os";
import * as __hydro_dep5 from "node:path";
import * as __hydro_dep6 from "node:test";
import * as __hydro_dep7 from "../../tools/gis/hydro-calibration-input.mjs";
import * as __hydro_dep8 from "node:fs";
import * as __hydro_dep9 from "../../tools/gis/hydro-calibration-report.mjs";

// Original feature contract: hydro-calibration-input.test.mjs
contractSuite("hydro-calibration-input", () => {
const assert = __hydro_dep0.default;
const { createHash } = __hydro_dep1;
const { spawnSync } = __hydro_dep2;
const { mkdir, mkdtemp, rm, writeFile } = __hydro_dep3;
const { tmpdir } = __hydro_dep4;
const { join } = __hydro_dep5;
const test = __hydro_dep6.default;
const { loadHydroCalibrationReferences, prepareHydroCalibrationSourceFiles } = __hydro_dep7;









test('calibration input reads only named Natural Earth files and keeps verified source identities',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-reference-'));t.after(()=>rm(root,{recursive:true}));
  const line={type:'Feature',id:'one',properties:{},geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}};
  const polygon={type:'Feature',id:'lake',properties:{},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}};
  for(const [name,features] of Object.entries({rivers_base:[line],lakes_base:[polygon],rivers_europe:[line],lakes_europe:[polygon]}))
    await writeFile(join(root,`${name}.geojson`),JSON.stringify({type:'FeatureCollection',features}));
  const regions=[{id:'europe',bbox:[0,0,2,2],riverLayer:'rivers_europe',lakeLayer:'lakes_europe'}];
  const output=await loadHydroCalibrationReferences({root,regions});
  assert.equal(output.references.europe.riverReference.baseFeatures[0].id,'one');
  assert.equal(output.references.europe.lakeReference.supplementFeatures[0].id,'lake');
  assert.equal(output.representativeSource.rivers.length,1);assert.equal(Object.keys(output.sourceFiles).length,4);
  assert.match(output.sourceFiles.rivers_base.sha256,/^[a-f0-9]{64}$/);
  await assert.rejects(loadHydroCalibrationReferences({root,regions:[{...regions[0],riverLayer:'../outside'}]}),/layer/i);
  const controller=new AbortController();controller.abort();await assert.rejects(loadHydroCalibrationReferences({root,regions,signal:controller.signal}),{name:'AbortError'});
});
test('calibration source discovery binds selected shapefile members and rejects ambiguity',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-hydro-source-paths-'));t.after(()=>rm(root,{recursive:true}));
  const riverRoot=join(root,'rivers'),lakeRoot=join(root,'lakes');await mkdir(riverRoot);await mkdir(lakeRoot);
  for(const ext of ['shp','dbf']){await writeFile(join(riverRoot,`HydroRIVERS_v10_eu.${ext}`),`river-${ext}`);
    await writeFile(join(lakeRoot,`HydroLAKES_polys_v10.${ext}`),`lake-${ext}`);}
  const input={riverRoots:[riverRoot],hydrolakes:join(lakeRoot,'HydroLAKES_polys_v10.shp'),regions:[{riverCode:'eu'}]};
  const result=await prepareHydroCalibrationSourceFiles(input);
  assert.equal(result.archives[0].specification.datasetCode,'eu');assert.equal(result.archives[0].files.shp.sha256,
    createHash('sha256').update('river-shp').digest('hex'));assert.equal(result.sources.hydroLakes.size,8);
  assert.deepEqual(Object.keys(result.lakeFiles).sort(),['dbf','shp']);
  const copy=join(riverRoot,'copy');await mkdir(copy);await writeFile(join(copy,'HydroRIVERS_v10_eu.shp'),'other');
  await assert.rejects(prepareHydroCalibrationSourceFiles(input),/exactly one/i);
});
test('calibration CLI rejects missing required source paths',()=>{
  const result=spawnSync(process.execPath,['tools/gis/calibrate-hydro.mjs'],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Expected --hydrorivers-root/);
});
});

// Original feature contract: hydro-calibration-report.test.mjs
contractSuite("hydro-calibration-report", () => {
const assert = __hydro_dep0.default;
const { readFileSync } = __hydro_dep8;
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = __hydro_dep8;
const { tmpdir } = __hydro_dep4;
const { join } = __hydro_dep5;
const { spawnSync } = __hydro_dep2;
const test = __hydro_dep6.default;
const { renderCalibrationReport, writeCalibrationReport } = __hydro_dep9;









const cases=JSON.parse(readFileSync(new URL('../fixtures/hydro-calibration-report-oracle.json',import.meta.url),'utf8'));
const metrics=JSON.parse(readFileSync(new URL('../fixtures/hydro-calibration-metrics-oracle.json',import.meta.url),'utf8'));
test('calibration report preserves Python results for pass and failure cases',()=>{
  for(const {input,expectedPrefix} of cases){
    const output=renderCalibrationReport(input);
    assert.equal(output.split('## 재현 방법')[0],expectedPrefix);
    assert.match(output,/node tools\/gis\/hydro-calibration-report\.mjs/);
    assert.doesNotMatch(output,/python tools\/calibrate-hydro\.py/i);
  }
});
test('report CLI renders results and refuses to overwrite existing evidence',t=>{
  const root=mkdtempSync(join(tmpdir(),'hydro-calibration-report-'));t.after(()=>rmSync(root,{recursive:true}));
  const input=join(root,'results.json'),output=join(root,'report.md');writeFileSync(input,JSON.stringify(cases[0].input));
  const args=['tools/gis/hydro-calibration-report.mjs','--input',input,'--output',output];
  const first=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  assert.equal(readFileSync(output,'utf8'),renderCalibrationReport(cases[0].input));
  const second=spawnSync(process.execPath,args,{encoding:'utf8'});assert.notEqual(second.status,0);
  assert.equal(readFileSync(output,'utf8'),renderCalibrationReport(cases[0].input));
});
test('calibration report refuses non-finite measurements instead of publishing them',()=>{
  const invalid=structuredClone(cases[0].input);invalid.worldEstimate.gzipMiB=NaN;
  assert.throws(()=>renderCalibrationReport(invalid),/finite/i);
});
test('report output cannot target runtime assets',t=>{
  const root=mkdtempSync(join(tmpdir(),'hydro-report-assets-'));t.after(()=>rmSync(root,{recursive:true}));
  const assets=join(root,'assets','data');mkdirSync(assets,{recursive:true});
  const input=join(root,'results.json');writeFileSync(input,JSON.stringify(cases[0].input));
  assert.throws(()=>writeCalibrationReport({root,input,output:join(assets,'report.md')}),/outside runtime assets/i);
});
test('report can verify acceptance against the underlying stage measurements',t=>{
  const root=mkdtempSync(join(tmpdir(),'hydro-report-acceptance-'));t.after(()=>rmSync(root,{recursive:true}));
  const input=join(root,'results.json'),output=join(root,'report.md'),result=structuredClone(cases[0].input);
  result.regions.europe={...metrics.acceptanceInput.regions.europe,label:'유럽'};result.acceptance=metrics.acceptance;
  result.representativeChecks=metrics.acceptanceInput.representativeChecks;
  writeFileSync(input,JSON.stringify(result));
  const args=['tools/gis/hydro-calibration-report.mjs','--input',input,'--output',output,'--verify-acceptance'];
  let run=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  result.acceptance.riverFinalWithin15Percent=!result.acceptance.riverFinalWithin15Percent;writeFileSync(input,JSON.stringify(result));
  run=spawnSync(process.execPath,[...args.slice(0,4),join(root,'bad.md'),'--verify-acceptance'],{encoding:'utf8'});
  assert.notEqual(run.status,0);assert.match(run.stderr,/acceptance/i);
});
});
