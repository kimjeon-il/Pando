import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tinyFixture } from '../fixture.mjs';
import { createNodeCoreProject } from '../../../tests/helpers/core-project.mjs';

test('verification fixture emits current ObjectRef timeline targets before any Core admission',()=>{
  const {project}=tinyFixture();
  assert.equal(project.timelineRecords.schemaVersion,3);
  for(const key of ['lifetimes','geometryBindings','parentRelations','propertyBindings']){
    for(const row of project.timelineRecords[key]){assert.equal(row.objectRef.domain,'territorial');assert.equal(Object.hasOwn(row,'entityId'),false);}
  }
});

test('the tiny stored project is admitted and resolved by the actual Core Worker', { timeout: 15000 }, async t => {
  const { project } = tinyFixture();
  const owner = await createNodeCoreProject(project);
  t.after(() => owner.dispose());
  const world = await owner.project.resolveWorld('2026-10');
  assert.equal(world.entities.length, 3);
  assert.equal(world.entities.find(row => row.objectRef.id === 'shell-child-a').parentId, 'shell-country-a');
});
