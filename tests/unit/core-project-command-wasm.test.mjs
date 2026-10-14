import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreProject } from '../helpers/core-project.mjs';

const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
const field=value => ({ commandId: 'territorial.field',targets: [{ domain: 'territorial',id: 'A' }],payload: { id: 'A',field: 'name',value } });

test('the application command owner pins accepted C++ preimages through queued commands and whole document Undo', async () => {
  const owner=await createNodeCoreProject(seed);
  try {
    const initial=owner.documentModel.snapshot();
    const initialViews=owner.documentModel.territorialViews();
    const [first,second]=await Promise.all([owner.project.executeCommand(field('First')),owner.project.executeCommand(field('Second'))]);
    assert.equal(first.before,initial);assert.equal(second.before,first.after);
    assert.equal(first.after.territorialEntities[0].properties.name,'First');
    assert.equal(second.after.territorialEntities[0].properties.name,'Second');
    assert.equal(first.before.territorialEntities[0].properties.name,seed.territorialEntities[0].properties.name);
    assert.equal(owner.documentModel.territorialViews()[0].properties.name,'Second');
    assert.equal(owner.documentModel.territorialViews()[1],initialViews[1]);
    assert.equal(owner.documentModel.territorialViews()[0].geometry,initialViews[0].geometry);
    assert.equal(owner.documentModel.world().sourceEpoch,owner.client.state().epoch);
    for (const name of ['labels','hydroEdits','genericFeatures','distributionLayers','distributionEntries','geometries','sourceInfo']) {
      assert.equal(first.after[name],initial[name]);assert.equal(second.after[name],initial[name]);
    }
    assert.equal(await owner.project.undo(),true);
    assert.deepEqual(owner.documentModel.snapshot(),first.after);
    const result=await owner.project.executeCommand(field('Third'));
    assert.equal(result.before.territorialEntities[0].properties.name,'First');
    assert.equal(result.after.territorialEntities[0].properties.name,'Third');
    assert.equal(owner.client.state().canRedo,false);assert.equal(owner.client.state().stateRevision,3);
  } finally { owner.dispose(); }
});
