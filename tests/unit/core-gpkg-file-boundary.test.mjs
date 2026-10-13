import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {productionGeoPackage,spatialLayerCount} from '../helpers/production-geopackage.mjs';

for(const name of ['static','complex'])test(`Core ${name} file export supplies same-epoch spatial facts to the byte encoder`,async t=>{
  const seed=JSON.parse(readFileSync(new URL(`../fixtures/timeline-exchange/${name}.json`,import.meta.url),'utf8'));
  const owner=await createNodeCoreProject(seed);t.after(()=>owner.dispose());const before=owner.client.state();
  const result=await owner.client.exportSnapshot({format:'pandolab-project-state',version:seed.version,savedAt:seed.savedAt});
  const body=JSON.parse(result.storageJson);
  assert.deepEqual(owner.client.state(),before);assert.deepEqual(result.state,before);
  assert.equal(result.spatialState===null,name==='complex');
  const file=await productionGeoPackage('write',new ArrayBuffer(0),body,result.spatialState);
  assert.equal(spatialLayerCount(file.buffer)>0,name==='static');
  assert.deepEqual(await owner.client.validateImport(JSON.stringify((await productionGeoPackage('read',file.buffer)).metadata.projectState)),body);
  assert.equal(Object.hasOwn(body,'spatialState'),false);assert.equal(Object.hasOwn(body,'checkpoint'),false);
});

test('the project byte encoder rejects a missing Core spatial receipt instead of resolving the model in JavaScript',async()=>{
  const body=JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/static.json',import.meta.url),'utf8'));
  await assert.rejects(productionGeoPackage('write',new ArrayBuffer(0),body),{code:'PL-GPKG-SPATIAL-PROJECTION'});
});
