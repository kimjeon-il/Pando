import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectOpenAdapter} from '../../../src/document/project-open-adapter.js';
import {createPlaceRuntime} from '../../../src/data/place-runtime.js';
import {createTerritorialLabels} from '../../../src/rendering/territorial-labels.js';
import {createPhysicalResources} from '../../../src/rendering/physical-map-controller.js';

// Source ownership is a public reader admission decision, not a literal
// sourceMode comparison or a particular internal function name.
test('selected reader remains authoritative regardless of the persisted sourceMode',async()=>{
  const document={format:'pandolab-project-state',documentId:'file',projectSetup:{sourceMode:'builtin'}};
  const file=createProjectOpenAdapter({source:'project',read:async()=>document});
  assert.equal(file.requiresSettledReplacement,false);
  assert.deepEqual(await file.prepare(),{source:'project',reason:'load',value:document,releaseCandidate:null});
  const baseline={baselineId:17,setup:{sourceMode:'project'}};
  const builtin=createProjectOpenAdapter({source:'builtin',read:async()=>baseline});
  assert.equal(builtin.requiresSettledReplacement,true);
  assert.equal(Object.isFrozen(await builtin.prepare()),true);
  assert.deepEqual(await builtin.prepare(),{source:'builtin',reason:'builtin',value:baseline,releaseCandidate:null});
  await assert.rejects(createProjectOpenAdapter({source:'project',read:async()=>({baselineId:17})}).prepare(),
    /cannot impersonate/);
});

test('replacing the active project discards pending Places work without publishing old labels',async()=>{
  let started,finish,publications=0,admissions=0;
  const ready=new Promise(resolve=>{started=resolve;});
  const previous=new Promise(resolve=>{finish=resolve;});
  const runtime=createPlaceRuntime({
    rpc:{stop(){},request:async()=>{started();return previous;}},
    admitReferences:async()=>{admissions++;},onSnapshot:()=>{publications++;},
  });
  try{
    const pending=runtime.prepare({projection:'flat',threshold:1,presentation:{month:'2026-10'}});
    await ready;
    runtime.resetProject();
    finish({result:{records:[],signature:'previous-project'}});
    assert.equal(await pending,false);
    assert.deepEqual(runtime.snapshot().records,[]);
    assert.equal(runtime.snapshot().signature,'empty');
    assert.deepEqual(runtime.selectionReferences(),[]);
    assert.equal(admissions,0);
    assert.equal(publications,0);
  }finally{runtime.dispose();}
});

test('labels and physical sources reject invalid owner and hide builtin data for file projects',async()=>{
  const labels=createTerritorialLabels({capabilities:{builtinPlaces:false,eagerBuiltinPlaces:false}});
  labels.setProjectSource('project');
  assert.deepEqual(labels.builtinPlaceSelectionReferences(),[]);
  assert.deepEqual(await labels.searchPlaces('Test'),{records:[],truncated:false});
  assert.equal(await labels.preparePlaces(),false);
  labels.setProjectSource('new');
  assert.deepEqual(labels.builtinPlaceSelectionReferences(),[]);
  assert.throws(()=>labels.setProjectSource('foreign'),/Unknown map source/);
  const physical=createPhysicalResources({buildMeta:{}});
  physical.setProjectSource('project');
  physical.setProjectSource('new');
  physical.setProjectSource('builtin');
  assert.throws(()=>physical.setProjectSource('foreign'),/Unknown active map source/);
});
