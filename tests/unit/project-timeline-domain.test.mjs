import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { prepareProjectForStorage,prepareProjectForActivation } from '../../shared/frontend/js/modules/project-state.js';

test('project domain resolves a month without changing stored project', async () => {
  const project = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
  const before = structuredClone(project);
  const core=await createNodeCoreProject(project);
  const admitted=core.project.snapshot();
  try {
    const july = await core.project.resolveWorld('1914-07');
    assert.equal(july.byId.get('A').geometryRef.version, 2);
    assert.equal(july.byId.get('B').parentId, 'A');
    assert.deepEqual(project, before);assert.deepEqual(core.project.snapshot(),admitted);
    assert.equal(core.client.state().dirty,false);assert.equal(core.client.state().canUndo,false);
  } finally { core.dispose(); }
});

test('project timeline requires its canonical core query dependency', async () => {
  await assert.rejects(createProjectDomain({ productMode:'editor' }).resolveWorld('1914-07'), /C\+\+ document query/);
});

test('P3 activation reuses the validated timeline storage without changing schema or resolved history',()=>{
 const project=JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json',import.meta.url),'utf8'));
 const original=structuredClone(project);
 const storage=prepareProjectForStorage(project);
 const active=prepareProjectForActivation(project);
 assert.deepEqual(active,storage);
 assert.equal(active.schemaVersion,14);
 assert.equal(active.timelineRecords.schemaVersion,3);
 assert.deepEqual(project,original,'detached preparation must never mutate the opened project');
 const second=prepareProjectForActivation(project);
 assert.deepEqual(second,storage,'repeated activation must preserve every record and geometry byte');
 const invalid=structuredClone(project);
 invalid.schemaVersion=13;
 assert.throws(()=>prepareProjectForActivation(invalid),{code:'PL-SCHEMA-OLD'});
});
