import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInitialDocument} from "../../shared/frontend/js/modules/initial-document.js";
import {createNodeCoreProject} from '../helpers/core-project.mjs';

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
