import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createGenericFeatureService } from '../helpers/generic-feature-command-service.mjs';
for(const fixture of ['reviewed.geojson','actual-line.geojson'])test('reviewed GeoJSON imports, edits, undoes and reopens via real Core: '+fixture,async()=>{
  const collection=JSON.parse(readFileSync(new URL('../fixtures/map-toolkit/'+fixture,import.meta.url)));
  if(fixture==='reviewed.geojson')assert.ok(collection.features.some(f=>f.geometry.type==='Polygon' && f.geometry.coordinates.length===2));
  else assert.deepEqual(collection.features.map(f=>f.geometry.type),['LineString']);
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url)));
  const owner=await createNodeCoreProject(seed,{appVersion:'plugin-test'});let reopened;
  try {
    const service=createGenericFeatureService({documentModel:owner.documentModel,commandOwner:owner.project});
    const before=service.list().length;
    const created=await service.addMany(collection.features);
    assert.equal(service.list().length,before+created.length);
    await owner.project.undo();assert.equal(service.list().length,before);
    await owner.project.redo();assert.equal(service.list().length,before+created.length);
    await service.updateMetadata(created[0].id,'name','Reviewed map line');
    assert.equal(service.get(created[0].id).properties.name,'Reviewed map line');
    const {project}=await owner.project.buildFileSnapshot();
    reopened=await createNodeCoreProject(project);
    const saved=createGenericFeatureService({documentModel:reopened.documentModel,commandOwner:reopened.project});
    assert.deepEqual(saved.list(),service.list());
    assert.equal(saved.get(created[0].id).properties.source.details.historicalAccuracy,'unverified');
  } finally {reopened?.dispose();owner.dispose();}
});
