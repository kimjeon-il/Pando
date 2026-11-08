import { describe as contractSuite } from 'node:test';
import * as __project_dep0 from "node:assert/strict";
import * as __project_dep1 from "node:test";
import * as __project_dep2 from "node:fs/promises";
import * as __project_dep3 from "../helpers/core-project.mjs";
import * as __project_dep4 from "../../src/document/project-domain.js";
import * as __project_dep5 from "../helpers/core-command-services/save-state-controller.mjs";
import * as __project_dep6 from "node:fs";
contractSuite("core-project-file-save-wasm", () => {
const assert = __project_dep0.default;
const test = __project_dep1.default;
const { readFile } = __project_dep2;
const { createNodeCoreProject } = __project_dep3;
const { createProjectDomain } = __project_dep4;
const { createSaveStateController } = __project_dep5;

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
});
contractSuite("core-project-replacement-wasm", () => {
const assert = __project_dep0.default;
const test = __project_dep1.default;
const { readFile } = __project_dep2;
const { createNodeCoreProject } = __project_dep3;
const { createProjectDomain } = __project_dep4;

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
});
contractSuite("core-project-admission-wasm", () => {
const assert = __project_dep0.default;
const { readFileSync } = __project_dep6;
const test = __project_dep1.default;
const { createNodeCoreProject } = __project_dep3;
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

test('rejecting invalid distribution references preserves the document and its history',async () => {
  const initial=seed();
  const owner=await createNodeCoreProject(initial);
  try {
    await owner.project.executeCommand(name('Unsaved edit'));
    const before=structuredClone(owner.documentModel.snapshot());
    const stateBefore=owner.client.state();
    for(const corrupt of [
      project => { project.distributionEntries[0].layerId='missing-layer'; },
      project => { project.distributionEntries[0].territorialUnitId='missing-territory'; },
      project => { project.distributionLayers[0].parentId=project.distributionLayers[0].id; },
      project => { project.distributionLayers.push(structuredClone(project.distributionLayers[0])); },
    ]) {
      const invalid=seed();corrupt(invalid);
      await assert.rejects(owner.project.admit(invalid));
      assert.deepEqual(owner.documentModel.snapshot(),before);
      const stateAfter=owner.client.state();
      assert.equal(stateAfter.stateRevision,stateBefore.stateRevision);
      assert.equal(stateAfter.documentDirty,stateBefore.documentDirty);
      assert.equal(stateAfter.canUndo,stateBefore.canUndo);
    }
    assert.equal(await owner.project.undo(),true);
    assert.equal(owner.documentModel.snapshot().territorialEntities[0].properties.name,initial.territorialEntities[0].properties.name);
  } finally { owner.dispose(); }
});
});
