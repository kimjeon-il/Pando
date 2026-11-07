import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:test";
import * as __dep1 from "node:assert/strict";
import * as __dep2 from "node:fs";
import * as __dep3 from "../../shared/frontend/js/modules/initial-document.js";
import * as __dep4 from "../helpers/core-project.mjs";

// Original feature contract: project-creation-contract.test.mjs
contractSuite("project-creation-contract", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { readFileSync } = __dep2;
const { createInitialDocument } = __dep3;
const { createNodeCoreProject } = __dep4;

const viewing=['defaultView','layerVisibility','itemVisibility'];
test('new projects carry one initial setup and no authored viewing defaults',()=>{
 const setup={initialMonth:'-0044-03',timelineRange:{start:'-0500-01',end:'0100-12'},initialMapBounds:{west:5,east:20,south:30,north:50},sourceMode:'empty'};
 const project=createInitialDocument({appVersion:'test',state:{projectSetup:setup}});
 assert.equal(project.schemaVersion,14);
 assert.deepEqual(project.projectSetup,setup);
 for(const key of viewing)assert.equal(Object.hasOwn(project,key),false,key);
});

test('Core file and autosave serialization exclude device viewing while preserving creation settings and styles',async()=>{
 const project=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
 const owner=await createNodeCoreProject(project,{appVersion:'test'});
 try{
  const admitted=owner.documentModel.snapshot();
  const receipt=await owner.project.buildFileSnapshot();
  assert.equal(receipt.project.schemaVersion,14);
  for(const key of viewing)assert.equal(Object.hasOwn(receipt.project,key),false,key);
  assert.deepEqual(receipt.project.projectSetup,project.projectSetup);
  assert.deepEqual(receipt.project.layerPresentation,admitted.layerPresentation);
  const saved=(await owner.project.buildAutosave()).project;
  for(const key of viewing)assert.equal(Object.hasOwn(saved,key),false,key);
  const before=JSON.parse(await owner.client.storageSnapshot());
  await owner.client.setTimelineCursor('1914-07');
  assert.deepEqual(JSON.parse(await owner.client.storageSnapshot()),before);
  const reopened=await createNodeCoreProject(receipt.project);
  try{assert.equal(reopened.client.state().timelineCursor,project.projectSetup.initialMonth);}finally{reopened.dispose();}
 }finally{owner.dispose();}
});
});

// Original feature contract: project-creation-storage.test.mjs
contractSuite("project-creation-storage", () => {
const test = __dep0.default;
const assert = __dep1.default;
const { readFileSync } = __dep2;
const { createInitialDocument } = __dep3;
const { createNodeCoreProject } = __dep4;

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
});
