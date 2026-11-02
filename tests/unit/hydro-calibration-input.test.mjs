import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadHydroCalibrationReferences,prepareHydroCalibrationSourceFiles} from '../../tools/gis/hydro-calibration-input.mjs';

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
