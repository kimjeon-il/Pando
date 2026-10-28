import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
const seed=() => {
  const project = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  // The document owner emits geometry records in ID/version order.
  project.geometries.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.version - b.version);
  return project;
};
const name=value => ({ commandId: 'territorial.field',targets: [{ domain: 'territorial',id: 'A' }],payload: { id: 'A',field: 'name',value } });

test('same-generation source admission publishes one complete C++ load between ordered commands and resets whole history',async () => {
  const initial=seed(),replacement=seed();replacement.territorialEntities[0].properties.name='Admitted source';
  const owner=await createNodeCoreProject(initial);
  try {
    const generation=owner.project.getGeneration();
    const first=owner.project.executeCommand(name('Previous document command'));
    const admission=owner.project.admit(replacement);
    const next=owner.project.executeCommand(name('Current document command'));
    const [old,accepted,current]=await Promise.all([first,admission,next]);
    assert.equal(old.after.territorialEntities[0].properties.name,'Previous document command');
    assert.deepEqual(accepted,replacement);assert.equal(current.before,accepted);
    assert.equal(current.after.territorialEntities[0].properties.name,'Current document command');
    assert.equal(owner.project.getGeneration(),generation);assert.equal(owner.client.state().stateRevision,1);
    assert.equal(owner.documentModel.world().sourceEpoch,owner.client.state().epoch);
    assert.equal(await owner.project.undo(),true);assert.deepEqual(owner.documentModel.snapshot(),replacement);
    assert.equal(owner.client.state().canUndo,false);assert.equal(owner.client.state().documentDirty,false);
    assert.equal(owner.client.state().presentationDirty,false);
    assert.deepEqual(JSON.parse(await owner.client.storageSnapshot()),replacement);
  } finally { owner.dispose(); }
});
