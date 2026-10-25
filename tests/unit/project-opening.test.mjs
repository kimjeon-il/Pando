import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialDocument} from "../../shared/frontend/js/modules/initial-document.js";
import {createNodeCoreProject} from '../helpers/core-project.mjs';
const seed=()=>createInitialDocument({appVersion:'0.36.0',baseDataset:'initial'});
const project=name=>({...seed(),baseDataset:name});

test('common project opening keeps the last request and validates through the readonly Core boundary',async()=>{
 const owner=await createNodeCoreProject(seed(),{productMode:'viewer',replaceSnapshot:async()=>true});
 try{
  await owner.project.open(async()=>project('first'));
  let release;
  const earlier=owner.project.open(()=>new Promise(resolve=>{release=resolve;}));
  assert.equal(await owner.project.open(async()=>project('latest')),true);
  release(project('stale'));assert.equal(await earlier,false);
  const before=owner.project.snapshot();
  await assert.rejects(owner.project.open(async()=>({format:'broken'})));
  assert.deepEqual(owner.project.snapshot(),before);
  assert.equal(await owner.project.open(async()=>null),false);
  assert.equal(owner.project.snapshot().baseDataset,'latest');
  assert.equal(owner.client.state().canUndo,false);
 }finally{owner.dispose();}
});

test('common opening rolls back failed or superseded presentation before accepting another project',async()=>{
 let release,started=false;const restored=[];
 const owner=await createNodeCoreProject(seed(),{productMode:'viewer',replaceSnapshot:async value=>{
  if(value.baseDataset==='broken')throw new Error('render failed');
  if(value.baseDataset==='slow'){started=true;await new Promise(resolve=>{release=resolve;});}
  return true;
 },restoreReplacement:async value=>restored.push(value.baseDataset)});
 try{
  await owner.project.open(async()=>project('first'));
  await assert.rejects(owner.project.open(async()=>project('broken')),/render failed/);
  assert.equal(owner.project.snapshot().baseDataset,'first');
  const earlier=owner.project.open(async()=>project('slow'));
  while(!started)await new Promise(resolve=>setImmediate(resolve));
  const latest=owner.project.open(async()=>project('latest'));release();
  assert.equal(await earlier,false);assert.equal(await latest,true);
  assert.equal(owner.project.snapshot().baseDataset,'latest');
  assert.deepEqual(restored,['first','first']);
 }finally{owner.dispose();}
});
