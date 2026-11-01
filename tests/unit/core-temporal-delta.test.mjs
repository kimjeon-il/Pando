import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDocumentSessionRuntime} from '../../shared/frontend/js/modules/core-document-runtime.js';
import {createCoreDocumentReadModel} from '../../shared/frontend/js/modules/core-document-read-model.js';
import {createProjectDomain} from '../../shared/frontend/js/modules/project-domain.js';

const seed=()=>JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
const fields={territorial:'territorialEntities',label:'labels',hydro:'hydroEdits',generic:'genericFeatures',distributionLayer:'distributionLayers',distributionEntry:'distributionEntries'};
const deltaFor=project=>({objects:[],orders:Object.fromEntries(Object.entries(fields).map(([domain,field])=>[domain,project[field].map(row=>row.id)])),
  geometries:[],removedGeometryRefs:[],timelineRecords:null,presentation:null,provenance:null,
  header:{set:{projectSetup:{...project.projectSetup,initialMonth:'2025-12'}},removedKeys:[]}});
const world=epoch=>({month:'2025-12',sourceEpoch:epoch,entities:[]});
const context={throwIfCancelled(){}};

test('temporal adoption publishes the Core delta without reading another whole document',async()=>{
  const project=seed(),delta=deltaFor(project),state={epoch:2,timelineCursor:'2025-12'};
  class Core {
    temporalCandidateAdopt(){return {state,delta};}
    documentSnapshot(){throw Error('Whole-document geometry must not be retransmitted');}
    selectionSnapshot(){return {items:[],primary:null,hover:null};}
    draftSnapshot(){return {active:false};}
    resolveWorld(month,epoch){assert.equal(month,'2025-12');assert.equal(epoch,2);return world(epoch);}
    delete(){}
  }
  const runtime=createDocumentSessionRuntime({loadModule:async()=>({DocumentSession:Core}),validateFlagDataUrl(){}});
  const packet=await runtime.temporalCandidateAdopt({},context);
  assert.deepEqual(packet.delta,delta);assert.equal(Object.hasOwn(packet,'project'),false);
  assert.deepEqual(packet.world,world(2));assert.equal(packet.state.epoch,2);
  const model=createCoreDocumentReadModel(project),geometry=model.geometry({id:'shape',version:1});
  model.acceptTransition(packet,'core.document-temporal-candidate-adopt');
  assert.equal(model.snapshot().projectSetup.initialMonth,'2025-12');
  assert.equal(model.snapshot().documentId,project.documentId);
  assert.strictEqual(model.geometry({id:'shape',version:1}),geometry);
  await runtime.dispose();
});

test('native first adoption still publishes a complete project, and malformed adoption is rejected',async()=>{
  const project=seed(),state={epoch:2,timelineCursor:'2025-12'};
  let malformed=false;
  class Core {
    temporalCandidateAdopt(){return malformed?{state}:{state,delta:null};}
    documentSnapshot(){return project;}
    selectionSnapshot(){return {items:[],primary:null,hover:null};}
    draftSnapshot(){return {active:false};}
    resolveWorld(){return world(2);}
    delete(){}
  }
  const runtime=createDocumentSessionRuntime({loadModule:async()=>({DocumentSession:Core}),validateFlagDataUrl(){}});
  assert.deepEqual((await runtime.temporalCandidateAdopt({},context)).project,project);
  malformed=true;
  await assert.rejects(runtime.temporalCandidateAdopt({},context),{code:'PL-CORE-DOCUMENT-ABI'});
  await runtime.dispose();
});

test('read-model adoption requires exactly one complete project or delta',()=>{
  const project=seed(),model=createCoreDocumentReadModel(project),before=model.snapshot();
  assert.throws(()=>model.acceptTransition({project,delta:deltaFor(project)},'core.document-temporal-candidate-adopt'),{code:'PL-CORE-RESPONSE'});
  assert.strictEqual(model.snapshot(),before);
  assert.throws(()=>model.acceptTransition({},'core.document-temporal-candidate-adopt'),{code:'PL-CORE-RESPONSE'});
  assert.strictEqual(model.snapshot(),before);
});

test('only explicit viewer temporal preparation reuses the accepted document identity',async()=>{
  const project=seed();project.projectSetup.sourceMode='builtin';let preparedId;
  const owner={state:()=>({epoch:1}),
    temporalSourcePrepare:async()=>({sourceId:2,fingerprint:'a'.repeat(64)}),
    temporalCandidatePrepare:async input=>{preparedId=input.documentId;return {...input,candidateId:3,expectedEpoch:1,worldSha256:'b'.repeat(64)};},
    temporalSourceRelease:async()=>true,
  };
  const domain=createProjectDomain({productMode:'viewer',commandOwner:owner,documentModel:{snapshot:()=>project}});
  const facts={sourceMonth:'2025-12',fingerprint:'a'.repeat(64)},setup={...project.projectSetup,initialMonth:'2025-12'};
  const options={dataRevision:'revision',manifestSha256:'c'.repeat(64),transition:true};
  await domain.prepareTemporalBuiltin(facts,setup,options);
  assert.equal(preparedId,project.documentId);
  await domain.prepareTemporalBuiltin(facts,setup,{...options,transition:false});
  assert.notEqual(preparedId,project.documentId);
  domain.dispose();
});
