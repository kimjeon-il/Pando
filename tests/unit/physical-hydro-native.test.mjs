import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {buildPhysicalHydro,physicalHydroProperties,physicalHydroCollection} from '../../tools/gis/build-physical-hydro.mjs';

const oracle=JSON.parse(readFileSync(new URL('../fixtures/physical-hydro-properties-oracle.json',import.meta.url),'utf8'));
test('physical hydro attributes match the existing Python source cases',()=>{
  for(const row of oracle)assert.deepEqual(physicalHydroProperties(row.record,row.layer,row.category,row.index),row.expected);
});
test('GDAL physical hydro matches the Python shapefile oracle and refuses overwrite',
  {skip:!process.env.PANDO_GDAL_OGR2OGR},t=>{
    const fixture=JSON.parse(readFileSync(new URL('../fixtures/physical-hydro-shapefile-oracle.json',import.meta.url),'utf8'));
    const root=mkdtempSync(join(tmpdir(),'pando-physical-hydro-')),source=join(root,'source'),output=join(root,'candidate');
    t.after(()=>rmSync(root,{recursive:true}));mkdirSync(source);
    for(const [name,base64] of Object.entries(fixture.files))writeFileSync(join(source,name),Buffer.from(base64,'base64'));
    const actual=buildPhysicalHydro({sourceRoot:source,outputRoot:output,gdal:process.env.PANDO_GDAL_OGR2OGR,root});
    for(let i=0;i<actual.layers.length;i++){
      const layer=actual.layers[i],expected=fixture.manifest.layers[i];
      assert.deepEqual(JSON.parse(readFileSync(join(output,'hydro',layer.id+'.geojson'))),fixture.layers[layer.id]);
      const {outputSha256,...withoutHash}=layer,{outputSha256:oldHash,...expectedWithoutHash}=expected;
      assert.deepEqual(withoutHash,expectedWithoutHash);
      assert.match(outputSha256,/^[a-f0-9]{64}$/);assert.match(oldHash,/^[a-f0-9]{64}$/);
    }
    const first=readFileSync(join(output,'hydro','rivers_base.geojson'));
    assert.throws(()=>buildPhysicalHydro({sourceRoot:source,outputRoot:output,gdal:process.env.PANDO_GDAL_OGR2OGR,root}),/exists/i);
    assert.deepEqual(readFileSync(join(output,'hydro','rivers_base.geojson')),first);
    assert.throws(()=>buildPhysicalHydro({sourceRoot:source,outputRoot:join(source,'nested'),gdal:process.env.PANDO_GDAL_OGR2OGR,root}),/outside/i);
    assert.equal(existsSync(join(source,'nested')),false);
    const link=join(root,'linked-source');symlinkSync(source,link,'junction');
    assert.throws(()=>buildPhysicalHydro({sourceRoot:source,outputRoot:join(link,'nested'),gdal:process.env.PANDO_GDAL_OGR2OGR,root}),/outside/i);
    assert.equal(existsSync(join(source,'nested')),false);
  });
test('physical hydro retains source feature order, coordinates and null-shape counts',()=>{
  const geometry={type:'MultiLineString',coordinates:[[[0,0],[1,0]],[[2,1],[3,1],[4,1]]]};
  const source={type:'FeatureCollection',features:[{type:'Feature',properties:{id:7},geometry},
    {type:'Feature',properties:{id:8},geometry:null},{type:'Feature',properties:{name:'River'},geometry:{type:'LineString',coordinates:[[1,1],[2,2]]}}]};
  const before=structuredClone(source),result=physicalHydroCollection(source,'rivers_base','river');
  assert.deepEqual(source,before);
  assert.equal(result.coordinateCount,7);assert.equal(result.skippedNullShapes,1);
  assert.deepEqual(result.collection.features.map(item=>item.id),['rivers_base:7','rivers_base:2']);
  assert.deepEqual(result.collection.features[0].geometry,geometry);
  assert.throws(()=>physicalHydroCollection({type:'FeatureCollection',features:[{geometry:{type:'Point',coordinates:[1,2]},properties:{}}]},'rivers_base','river'),/line/i);
});
test('existing physical generator delegates hydro to the same Node/GDAL owner',
  {skip:!process.env.PANDO_GDAL_OGR2OGR||!process.env.PANDO_PHYSICAL_PYTHON},t=>{
    const fixture=JSON.parse(readFileSync(new URL('../fixtures/physical-hydro-shapefile-oracle.json',import.meta.url),'utf8'));
    const root=mkdtempSync(join(tmpdir(),'pando-physical-legacy-')),source=join(root,'source'),output=join(root,'candidate');
    t.after(()=>rmSync(root,{recursive:true}));mkdirSync(source);
    for(const [name,base64] of Object.entries(fixture.files))writeFileSync(join(source,name),Buffer.from(base64,'base64'));
    const processResult=spawnSync(process.env.PANDO_PHYSICAL_PYTHON,['tools/build-physical-data.py',source,output,'--hydro-only'],
      {encoding:'utf8',windowsHide:true,env:process.env,timeout:60000});
    if(processResult.error)throw processResult.error;
    assert.equal(processResult.status,0,processResult.stderr);
    for(const [id,expected] of Object.entries(fixture.layers))
      assert.deepEqual(JSON.parse(readFileSync(join(output,'hydro',id+'.geojson'))),expected);
  });
