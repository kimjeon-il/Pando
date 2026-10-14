import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreProject } from '../helpers/core-project.mjs';

test('actual retained C++ preview supplies small immutable geometry-policy input and cancellation leaves every live domain unchanged',async () => {
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  const owner=await createNodeCoreProject(seed);
  try {
    const before=owner.documentModel.snapshot(),world=owner.documentModel.world(),views=owner.documentModel.territorialViews(),state=owner.client.state();
    const prepared=await owner.client.prepare({ commandId: 'territorial.field',targets: [{ domain: 'territorial',id: 'A' }],
      payload: { id: 'A',field: 'name',value: 'Prepared only' } });
    assert.equal(prepared.ok,true);assert.ok(prepared.candidateId>0);
    const source=await owner.client.candidateProjection(prepared.candidateId,prepared.state.epoch);
    const preview=owner.documentModel.candidateProjection(source,prepared.state.epoch);
    assert.equal(preview.territorialViews[0].properties.name,'Prepared only');assert.equal(preview.territorialViews[0].geometry,views[0].geometry);
    assert.equal(source.delta.objects.length,1);assert.deepEqual(source.delta.geometries,[]);
    assert.equal(owner.documentModel.snapshot(),before);assert.equal(owner.documentModel.world(),world);
    assert.equal(owner.documentModel.territorialViews(),views);assert.deepEqual(owner.client.state(),state);
    assert.equal(await owner.client.cancel(prepared.candidateId),true);assert.deepEqual(owner.client.state(),state);
    assert.deepEqual(JSON.parse(await owner.client.storageSnapshot()),seed);
  } finally { owner.dispose(); }
});

test('accepted preview platform failure restores the C++ document, whole history, selection and draft before publication can save',async t => {
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  const events=[],autosaves=[];
  const owner=await createNodeCoreProject(seed,{ onProjectChanged: event => events.push(event),
    persistence: { queueProject: (...args) => autosaves.push(args) } });
  t.after(() => owner.dispose());
  await owner.client.selectionApply({ action: 'replace',ref: { domain: 'territorial',type: 'entity',id: 'A' } });
  await owner.client.draftApply({ action: 'start',shape: 'line',coords: [[1,2],[3,4]],phase: 'refine' });
  const before=owner.documentModel.snapshot(),state=owner.client.state();
  const selection=await owner.client.selectionSnapshot(),draft=await owner.client.draftSnapshot();
  const prepared=await owner.project.prepareCommand({ commandId: 'territorial.field',targets: [{ domain: 'territorial',id: 'A' }],
    payload: { id: 'A',field: 'name',value: 'Prepared platform failure' } });
  const failure=new Error('injected accepted renderer failure');
  await assert.rejects(owner.project.confirmCandidate(prepared.candidateId,prepared.state.epoch,{ applyAccepted: result => {
    assert.equal(result.after.territorialEntities[0].properties.name,'Prepared platform failure');
    throw failure;
  } }),error => error===failure);
  assert.deepEqual(owner.documentModel.snapshot(),before);
  const restored=owner.client.state();
  assert.equal(restored.checkpoint,state.checkpoint);assert.equal(restored.dirty,state.dirty);
  assert.equal(restored.stateRevision,state.stateRevision);assert.equal(restored.canUndo,state.canUndo);
  assert.deepEqual(await owner.client.selectionSnapshot(),selection);
  assert.deepEqual(await owner.client.draftSnapshot(),draft);
  assert.deepEqual(events,[]);assert.deepEqual(autosaves,[]);
});

test('autosave waits for a held accepted platform effect and exports only the rolled-back Core checkpoint after its failure',async t=>{
  const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url),'utf8'));
  const owner=await createNodeCoreProject(seed,{appVersion:seed.version});t.after(()=>owner.dispose());
  let entered,release;
  const started=new Promise(resolve=>{entered=resolve;}),barrier=new Promise(resolve=>{release=resolve;});
  const before=owner.documentModel.snapshot(),state=owner.client.state(),failure=new Error('held platform effect failed');
  const command=owner.project.executeCommand({commandId:'territorial.field',targets:[{domain:'territorial',id:'A'}],
    payload:{id:'A',field:'name',value:'Must not leak into autosave'}},{applyAccepted:async()=>{entered();await barrier;throw failure;}});
  const rejected=assert.rejects(command,error=>error===failure);
  await started;
  let exported=false;
  const saving=owner.project.buildAutosave().then(receipt=>{exported=true;return receipt;});
  try {
    // This explicit later Core query settles anything already dispatched on
    // the Worker queue, without sleep polling or a guessed event-loop delay.
    await owner.client.projectState();
    assert.equal(exported,false,'A pending platform adoption is not a publishable document checkpoint.');
  } finally {release();await rejected;}
  const receipt=await saving;
  assert.deepEqual(receipt.project.territorialEntities,before.territorialEntities);
  assert.equal(receipt.checkpoint.content,state.checkpoint);
  assert.deepEqual(owner.documentModel.snapshot(),before);
  assert.equal(owner.project.canUndo(),false);
});
