import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createTerritorialEntityRepository } from "../../shared/frontend/js/modules/territorial-entity-repository.js";

test('territorial store and hierarchy index read the same accepted C++ document without a second writable timeline owner',async () => {
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  const owner=await createNodeCoreProject(seed),events=[];
  const store=createTerritorialEntityStore({ documentModel: owner.documentModel,commandOwner: owner.client,
    onEntitiesReplaced: (_values,event) => events.push(event) }),repository=createTerritorialEntityRepository({ entityStore: store });
  try {
    const before=store.snapshot();assert.equal(before,owner.documentModel.territorialViews());
    assert.equal(repository.get('A'),before[0]);assert.ok(before[0].geometry);
    for (const method of ['setField','setLocked','transaction','restoreProject','replaceEntities','applyChanges','appendEntities','removeEntities'])
      assert.equal(Object.hasOwn(store,method),false,`The obsolete writable API must be retired: ${method}`);
    await owner.project.executeCommand({ commandId: 'territorial.metadata',targets: [{ domain: 'territorial',id: 'A' }],
      payload: { id: 'A',field: 'name',valuePresent: true,value: 'Read-only accepted name' } });
    assert.equal(repository.get('A').properties.name,'Read-only accepted name');assert.equal(repository.get('A').geometry,before[0].geometry);
    assert.equal(repository.get('B'),before[1]);assert.deepEqual([...events[0].changedIds],['A']);
    assert.equal(await store.setTimelineCursor('1914-07'),true);
    const world=await store.resolveWorld('1914-07');
    assert.equal(world.sourceEpoch,owner.client.state().epoch);assert.equal(world.byId.get('A').geometry,repository.get('A').geometry);
    assert.equal(await store.setTimelineCursor('1914-07'),false);
    const state=owner.client.state();
    await assert.rejects(store.setTimelineCursor('1914-08',{ canPublish: () => false }),{ code: 'TIMELINE_DRAFT_ACTIVE' });
    assert.deepEqual(owner.client.state(),state);
    assert.equal(await owner.project.undo(),true);assert.equal(repository.get('A').properties.name,seed.territorialEntities[0].properties.name);
    assert.deepEqual(JSON.parse(await owner.client.storageSnapshot()),seed);
    assert.equal(owner.client.state().timelineCursor,'1914-07','Undo restores the edit while preserving the chosen viewing month');
  } finally { store.dispose();owner.dispose(); }
});
