import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";
import { createHistoryAssembly } from "../../apps/editor/frontend/js/modules/app-history-assembly.js";
import { createSaveStateController } from "../../apps/editor/frontend/js/modules/save-state-controller.js";
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {createCoreStartupState,startupBaseline,startupDocument} from '../helpers/core-startup.mjs';

test('project autosave rejects a receipt completed after project replacement', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let exportStarted;
  const started = new Promise(resolve=>{exportStarted=resolve;});
  const domain = createProjectDomain({ productMode:'editor', appVersion: 'fixture',commandOwner: {
    exportSnapshot: async () => { exportStarted();await held;return { storageJson: '{"format":"pandolab-autosave-full"}',state: { epoch: 1,checkpoint: 0,presentationCheckpoint: 0 } }; },
    validateImport: async bytes => JSON.parse(bytes),captureReplacement: async () => 7,load: async () => {},releaseReplacement: async () => true,
  },documentModel: { snapshot: () => ({}) },readBuiltinSelectionCatalogs: () => [],replaceSnapshot: () => true });
  const pending = domain.buildAutosave();
  await started;
  await domain.load({}); release();
  await assert.rejects(pending, { code: 'PL-PERSISTENCE-STALE' });
});

test('actual autosave composition uses one receipt and acknowledgement retains file dirty', async t => {
  const beforeWindow = globalThis.window;
  t.after(() => { globalThis.window = beforeWindow; });
  globalThis.window = { indexedDB: {}, localStorage: {} };
  let core={ epoch: 1,checkpoint: 1,presentationCheckpoint: 0,documentDirty: true,presentationDirty: false };
  const saveState = createSaveStateController({ getDocumentState: () => core });
  const state = { projectReplacing: false, lastSavedAt: null };
  let generation = 1, options;
  const receipt = { project: { format: 'pandolab-autosave-full' }, checkpoint: { projectGeneration: generation,
    epoch: core.epoch,content: core.checkpoint,presentation: core.presentationCheckpoint } };
  const owner = createHistoryAssembly();
  owner.connect({ projectState: { state }, projectSession: { saveState }, platformConfigurationA: {}, platformConfigurationB: {},
    projectServices: { createBrowserProjectStorage: () => ({}),createPersistenceService: value => { options = value;return {}; } },
    domains: { projectDomain: { buildAutosave: async () => receipt,getGeneration: () => generation,state: () => core } },
  });
  owner.initializeBrowserProjectStorage();
  assert.equal(await options.buildAutosave(), receipt);
  assert.equal(options.onSaved('first', receipt), true);
  assert.equal(state.lastSavedAt, 'first'); assert.equal(saveState.snapshot().documentDirty, true);
  core={ ...core,epoch: 2,checkpoint: 2 };saveState.sync();
  assert.equal(options.onSaved('stale-content', receipt), false); assert.equal(state.lastSavedAt, 'first');
  generation += 1;
  assert.equal(options.onSaved('stale-project', receipt), false); assert.equal(state.lastSavedAt, 'first');
});

test('cold autosave validation and preview need no date-dependent builtin baseline',async t=>{
  const source=startupDocument([{id:'A',type:'Feature',properties:{schemaVersion:6,entityKind:'general',name:'A',parentId:'',coverageMode:'explicit',
    locked:false,style:{color:'#123456'},metadata:{}},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}]);
  const producer=await createNodeCoreProject(source,{appVersion:'fixture'});
  let delta;
  try {
    await startupBaseline(source,producer.project,'2026-10',{kind:'static-features'});
    const edited=await producer.project.executeCommand({commandId:'territorial.metadata',targets:[{domain:'territorial',id:'A'}],
      payload:{id:'A',field:'notes',valuePresent:true,value:'Recovered notes'}});
    assert.equal(edited.ok,true);
    delta=(await producer.project.buildAutosave()).project;
    assert.equal(delta.format,'pandolab-autosave-full');
  } finally {producer.dispose();}
  const consumer=await createCoreStartupState(t),before=consumer.documentModel.snapshot();
  let options,receipt,preparations=0;
  const beforeWindow=globalThis.window;t.after(()=>{globalThis.window=beforeWindow;});
  globalThis.window={indexedDB:{},localStorage:{}};
  const assembly=createHistoryAssembly();
  assembly.connect({projectState:{state:consumer.state},projectSession:{saveState:consumer.saveState},
    platformConfigurationA:{},platformConfigurationB:{},domains:{projectDomain:consumer.project},
    projectServices:{createBrowserProjectStorage:()=>({}),createPersistenceService:value=>{options=value;return{};}},
    builtinBaseline:{prepareProjectBaseline:async()=>{++preparations;return receipt ||= await startupBaseline(source,consumer.project,'2026-10',{kind:'static-features'});}},
  });
  assembly.initializeBrowserProjectStorage();
  const restored=await options.validateProject(delta);
  assert.equal(restored.territorialEntities[0].properties.notes,'Recovered notes');
  const sourceId=consumer.client.state().storageBaselineId;
  assert.equal(sourceId,0);assert.equal(consumer.documentModel.snapshot(),before);
  const preview=await options.previewProjection(delta);
  assert.equal(preview.project,delta);assert.equal(preview.territorialViews[0].properties.notes,'Recovered notes');
  assert.equal(preview.territorialViews[0].geometry.type,'Polygon');
  assert.equal(consumer.client.state().storageBaselineId,sourceId);assert.equal(consumer.documentModel.snapshot(),before);
  assert.equal(consumer.project.canUndo(),false);assert.equal(preparations,0);
});
