import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createProjectDomain } from '../../assets/js/modules/project-domain.js';
import { createNodeCoreProject } from '../helpers/core-project.mjs';

test('project domain resolves a month without changing stored project', async () => {
  const project = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
  const before = structuredClone(project);
  const core=await createNodeCoreProject(project);
  try {
    const july = await core.project.resolveWorld('1914-07');
    assert.equal(july.byId.get('A').geometryRef.version, 2);
    assert.equal(july.byId.get('B').parentId, 'A');
    assert.deepEqual(project, before);assert.deepEqual(core.project.snapshot(),before);
    assert.equal(core.client.state().dirty,false);assert.equal(core.client.state().canUndo,false);
  } finally { core.dispose(); }
});

test('project timeline requires its canonical core query dependency', async () => {
  await assert.rejects(createProjectDomain().resolveWorld('1914-07'), /C\+\+ document query/);
});
