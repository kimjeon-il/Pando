import {normalizeGenericFeatureSemantics} from "../../apps/editor/frontend/js/modules/generic-feature-service.js";
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {productionGeoPackage,spatialLayerCount,spatialColumns} from '../helpers/production-geopackage.mjs';

for(const name of ['static','complex'])test(`Core ${name} file export supplies same-epoch spatial facts to the byte encoder`,async t=>{
  const seed=JSON.parse(readFileSync(new URL(`../fixtures/timeline-exchange/${name}.json`,import.meta.url),'utf8'));
  if(name==='static') seed.genericFeatures.push(normalizeGenericFeatureSemantics({type:'Feature',id:'ac7332ab-e9e8-4f20-a14e-b7291ddf5f1d',
    geometry:{type:'Point',coordinates:[0,0]},properties:{schemaVersion:2,name:'Point',source:{kind:'user'}}}));
  const owner=await createNodeCoreProject(seed);t.after(()=>owner.dispose());const before=owner.client.state();
  const result=await owner.client.exportSnapshot({format:'pandolab-project-state',version:seed.version,savedAt:seed.savedAt});
  const body=JSON.parse(result.storageJson);
  assert.deepEqual(owner.client.state(),before);assert.deepEqual(result.state,before);
  assert.equal(result.spatialState===null,name==='complex');
  const file=await productionGeoPackage('write',new ArrayBuffer(0),body,result.spatialState);
  assert.equal(spatialLayerCount(file.buffer)>0,name==='static');
  if(name==='static') for(const table of ['generic_features_point']) {
    const columns=spatialColumns(file.buffer,table);
    assert.ok(columns.includes('properties_json'));
    for(const retired of ['role','owner_id','parent_id','topology_group','land_binding']) assert.equal(columns.includes(retired),false);
  }
  const accepted=await owner.client.validateImport(JSON.stringify((await productionGeoPackage('read',file.buffer)).metadata.projectState));
  const reopened=await createNodeCoreProject(accepted);t.after(()=>reopened.dispose());
  assert.deepEqual(JSON.parse(await reopened.client.storageSnapshot()),body);
  assert.equal(Object.hasOwn(body,'spatialState'),false);assert.equal(Object.hasOwn(body,'checkpoint'),false);
});

test('the project byte encoder rejects a missing Core spatial receipt instead of resolving the model in JavaScript',async()=>{
  const body=JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/static.json',import.meta.url),'utf8'));
  await assert.rejects(productionGeoPackage('write',new ArrayBuffer(0),body),{code:'PL-GPKG-SPATIAL-PROJECTION'});
});
