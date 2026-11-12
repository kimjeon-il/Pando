// Validate observable document admission and read-only Core ownership. Internal
// function spellings, queue layout and C++ formatting are not API contracts.
import fs from 'node:fs';
import path from 'node:path';
import {buildFrontendIndex} from './lib/frontend-layout.mjs';
import {createProductModePolicy} from '../src/app/product-mode-policy.js';
import {createProjectOpenAdapter} from '../src/document/project-open-adapter.js';
import {createTerritorialEntityStore} from '../src/document/territorial-entity-store.js';

const root=process.cwd(),failures=[],index=buildFrontendIndex(root);
const fail=message=>failures.push(message);
const required=[
  'assets/js/modules/core-document-client.js',
  'assets/js/modules/core-document-read-model.js',
  'assets/js/modules/project-domain.js',
  'assets/js/modules/territorial-entity-store.js',
  'src/document/native/include/pandoeditor/document-session.h',
  'src/document/native/src/document-session.cpp',
  'src/document/native/bindings/session-bindings.cpp',
];
for(const name of required)if(!index.has(name)&&!fs.existsSync(path.join(root,name)))
  fail('Missing canonical document/Core boundary: '+name);
for(const retired of ['project-command-pipeline.js','document-mutation-runner.js',
  'history-service.js','draft-editor.js','project-transaction.js','map-edit-transaction.js'])
  if(index.has('assets/js/modules/'+retired))
    fail('Retired parallel document writer remains: '+retired);

try{
  const viewer=createProductModePolicy('viewer',{readOnly:true});
  viewer.assertOperation('core.document-state');
  viewer.assertOperation('core.document-timeline-cursor');
  try {
    viewer.assertOperation('generic.delete');
    fail('Read-only viewer permitted an authored document writer');
  } catch(error) {
    if(error.code!=='PL-PRODUCT-READONLY')fail('Unexpected read-only refusal: '+error.message);
  }
  const file={format:'pandolab-project-state',documentId:'fixture',projectSetup:{sourceMode:'builtin'}};
  const opened=await createProjectOpenAdapter({source:'project',read:async()=>file}).prepare();
  if(opened.reason!=='load'||opened.source!=='project'||opened.value!==file)
    fail('File source lost independent admission');
  const builtin=await createProjectOpenAdapter({source:'builtin',read:async()=>({baselineId:4})}).prepare();
  if(builtin.reason!=='builtin'||builtin.value.baselineId!==4)
    fail('Builtin source no longer requires admitted Core source');

  let cursor='1914-07',subscriptions=0;
  const model={territorialViews:()=>[],list:()=>[],world:()=>[],projectWorld:world=>world};
  const owner={
    state:()=>({timelineCursor:cursor,epoch:1}),
    subscribeTransitions:()=>{subscriptions++;return()=>subscriptions--;},
    resolveWorld:async month=>[{month}],
    setTimelineCursor:async month=>{cursor=month;return{state:{timelineCursor:month}};},
  };
  const store=createTerritorialEntityStore({documentModel:model,commandOwner:owner});
  try{
    if(!Object.isFrozen(store)||typeof store.resolveWorld!=='function')
      fail('Current-world projection is not a readonly Core owner');
    for(const method of ['setField','transaction','removeEntities','replaceEntities','applyChanges'])
      if(method in store)fail('Read-only territorial projection exposes a writer: '+method);
    const world=await store.resolveWorld('1914-08');
    if(!Array.isArray(world)||world[0]?.month!=='1914-08')
      fail('Territorial world query did not forward the Core result');
    if(await store.setTimelineCursor('1914-08')!==true||cursor!=='1914-08')
      fail('Time navigation did not call the accepted Core owner');
  }finally{store.dispose();}
  if(subscriptions!==0)fail('Territorial projection leaked Core subscriptions');
}catch(error){fail('Document ownership behavior failed: '+error.stack);}

if(failures.length){
  for(const failure of failures)console.error('- '+failure);
  process.exitCode=1;
}else console.log('Document ownership verified through Core read-only and project admission behavior.');
