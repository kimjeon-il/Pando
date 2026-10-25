import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";
import { createSaveStateController } from "../../apps/editor/frontend/js/modules/save-state-controller.js";

test('file save encodes Core output and a late device write cannot clean a newer complete document',async () => {
  const seed=JSON.parse(await readFile(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8')),
    owner=await createNodeCoreProject(seed),saveState=createSaveStateController({ getDocumentState: owner.client.state });
  const encoded=[];
  const project=createProjectDomain({ productMode:'editor', commandOwner: owner.client,documentModel: owner.documentModel,publishCommand() {},
    appVersion: 'fixture-version',saveState,createProjectFile: async body => { encoded.push(body);return body; } });
  try {
    await project.executeCommand({ commandId: 'territorial.field',targets: [{ domain: 'territorial',id: 'A' }],payload: { id: 'A',field: 'name',value: 'Exported name' } });
    let release,signalWritten;const held=new Promise(resolve => { release=resolve; }),writing=new Promise(resolve => { signalWritten=resolve; });
    const pending=project.save(async body => { signalWritten();await held;assert.equal(body,encoded[0]);return { downloaded: false }; });
    await writing;
    assert.equal(encoded[0].version,'fixture-version');assert.equal(Object.hasOwn(encoded[0],'checkpoint'),false);
    assert.equal(encoded[0].territorialEntities.find(row => row.id==='A').properties.name,'Exported name');
    await project.executeCommand({ commandId: 'territorial.field',targets: [{ domain: 'territorial',id: 'A' }],payload: { id: 'A',field: 'name',value: 'Newer name' } });
    release();assert.equal(await pending,true);assert.equal(owner.client.state().documentDirty,true);
    assert.equal(saveState.snapshot().file,'dirty');assert.equal(owner.documentModel.get({ domain: 'territorial',id: 'A' }).properties.name,'Newer name');
    assert.equal(await project.save(async () => ({ downloaded: true })),true);
    assert.equal(owner.client.state().dirty,false);assert.equal(saveState.snapshot().file,'download-created');
    assert.equal(encoded[1].territorialEntities.find(row => row.id==='A').properties.name,'Newer name');
    assert.equal(owner.client.state().canUndo,true);assert.equal(await project.undo(),true);
    assert.equal(saveState.snapshot().documentDirty,true);assert.equal(saveState.snapshot().file,'dirty');
  } finally { project.dispose();owner.dispose(); }
});
