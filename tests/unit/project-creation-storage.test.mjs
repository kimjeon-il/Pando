import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialDocument} from "../../shared/frontend/js/modules/initial-document.js";
import {createNodeCoreProject} from '../helpers/core-project.mjs';

test('new documents have independent identity and only one creation setup',()=>{
 const a=createInitialDocument({appVersion:'test'}),b=createInitialDocument({appVersion:'test'});
 assert.equal(a.schemaVersion,14);assert.notEqual(a.documentId,b.documentId);
 assert.match(a.documentId,/^[0-9a-f-]{36}$/);assert.equal(typeof a.projectSetup.initialMonth,'string');
 for(const key of ['defaultView','editorState','physicalSettings','layerVisibility','itemVisibility'])assert.equal(Object.hasOwn(a,key),false,key);
});
test('retired settings commands and old saves cannot change the active document',async()=>{
 const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url)));
 seed.labels[0].territorialUnitId='missing-label-owner';
 const owner=await createNodeCoreProject(seed);
 try{
  const before=JSON.parse(await owner.client.storageSnapshot()),state=owner.client.state();
  for(const commandId of ['project.default-view','project.configure'])await assert.rejects(owner.project.executeCommand({commandId,targets:[],payload:{}}));
  await assert.rejects(owner.client.load(JSON.stringify({...seed,schemaVersion:13})),/UNSUPPORTED_VERSION/);
  assert.deepEqual(JSON.parse(await owner.client.storageSnapshot()),before);assert.deepEqual(owner.client.state(),state);
  const reopened=await createNodeCoreProject(before);
  try{assert.equal(reopened.client.state().timelineCursor,seed.projectSetup.initialMonth);assert.deepEqual(reopened.documentModel.snapshot().labels,before.labels);assert.deepEqual(reopened.documentModel.snapshot().geometries,before.geometries);}finally{reopened.dispose();}
 }finally{owner.dispose();}
});
