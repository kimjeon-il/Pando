import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";

test('a failed post-load platform replacement restores the same C++ full history, selection and detached draft',async () => {
  const seed=JSON.parse(await readFile(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  const owner=await createNodeCoreProject(seed),failure=new Error('The platform mesh was not staged.');
  try {
    const initialSnapshot=owner.documentModel.snapshot();
    await owner.project.executeCommand({ commandId: 'territorial.field',targets: [{ domain: 'territorial',id: 'A' }],
      payload: { id: 'A',field: 'name',value: 'Before failed open' } });
    await owner.client.selectionApply({ action: 'replace',ref: { domain: 'territorial',type: 'entity',id: 'A' },scope: 'map' });
    await owner.client.draftApply({ action: 'start',shape: 'line',coords: [[0,0],[1,1]],inputPhase: 'draw' });
    await owner.client.draftApply({ action: 'append',coordinate: [2,2] });
    const before=owner.documentModel.snapshot(),state=owner.client.state(),selection=await owner.client.selectionSnapshot(),draft=await owner.client.draftSnapshot();
    let restored;const effects=[];
    const project=createProjectDomain({ productMode:'editor', commandOwner: owner.client,documentModel: owner.documentModel,publishCommand() {},
      readBuiltinSelectionCatalogs: () => [],
      onProjectReset: async event => effects.push(event.reason),
      replaceSnapshot: async () => { throw failure; },restoreReplacement: async value => { restored=value;effects.push('render-restored'); } });
    await assert.rejects(project.load(seed),error => error===failure);
    assert.deepEqual(restored,before);assert.deepEqual(owner.documentModel.snapshot(),before);
    const accepted=owner.client.state();assert.ok(accepted.epoch>state.epoch);
    assert.equal(accepted.checkpoint,state.checkpoint);assert.equal(accepted.stateRevision,state.stateRevision);
    assert.equal(accepted.documentDirty,state.documentDirty);assert.equal(accepted.presentationDirty,state.presentationDirty);
    assert.equal(accepted.canUndo,true);assert.equal(accepted.canRedo,false);
    assert.deepEqual(await owner.client.selectionSnapshot(),selection);assert.deepEqual(await owner.client.draftSnapshot(),draft);
    assert.deepEqual(effects,['project-load','project-rollback','render-restored']);assert.equal(project.getGeneration(),2);
    assert.equal(project.isReplacing(),false);
    assert.equal(await project.undo(),true);assert.deepEqual(owner.documentModel.snapshot(),initialSnapshot);assert.equal(project.canRedo(),true);
    project.dispose();
  } finally { owner.dispose(); }
});
