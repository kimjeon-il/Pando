import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tinyFixture } from '../fixture.mjs';
import { createNodeCoreProject } from '../../../tests/helpers/core-project.mjs';

test('the tiny stored project is admitted and resolved by the actual Core Worker', { timeout: 15000 }, async t => {
  const { project } = tinyFixture();
  const owner = await createNodeCoreProject(project);
  t.after(() => owner.dispose());
  const world = await owner.project.resolveWorld('2026-10');
  assert.equal(world.entities.length, 3);
  assert.equal(world.entities.find(row => row.id === 'shell-child-a').parentId, 'shell-country-a');
});
