import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaveStateController } from "../../apps/editor/frontend/js/modules/save-state-controller.js";

test('save UI derives history/dirty tokens from Core and device acknowledgements cannot clean the document',() => {
  let core=null;const events=[];
  const owner=createSaveStateController({ getDocumentState: () => core,onChange: (_value,reason) => events.push(reason) });
  assert.equal(owner.snapshot().currentContentToken,null);
  core=Object.freeze({ epoch: 1,checkpoint: 0,presentationCheckpoint: 0,documentDirty: false,presentationDirty: false });
  owner.markNewProject();assert.equal(owner.snapshot().file,'never-saved');
  core=Object.freeze({ ...core,epoch: 2,checkpoint: 1,documentDirty: true });owner.sync();
  assert.equal(owner.snapshot().file,'dirty');assert.equal(owner.snapshot().currentContentToken,'content:1');
  owner.markFileSaved();assert.equal(owner.snapshot().hasUnsavedChanges,true);assert.equal(owner.snapshot().file,'dirty');
  core=Object.freeze({ ...core,epoch: 3,documentDirty: false });owner.sync();assert.equal(owner.snapshot().file,'saved');
  const io=owner.checkpoint();core=Object.freeze({ ...core,epoch: 4,presentationCheckpoint: 1,presentationDirty: true });
  owner.restore(io);assert.equal(owner.snapshot().presentationDirty,true);assert.equal(owner.snapshot().file,'dirty');
  assert.equal(owner.snapshot().currentPresentationToken,'presentation:1');
  owner.markFileSaving();assert.equal(owner.snapshot().file,'saving');
  core=Object.freeze({ ...core,epoch: 5,checkpoint: 2,documentDirty: true });owner.sync();assert.equal(owner.snapshot().file,'dirty');
  assert.equal(Object.hasOwn(owner,'markContentChanged'),false);assert.equal(Object.hasOwn(owner,'setContentToken'),false);
  assert.equal(Object.hasOwn(owner,'markPresentationChanged'),false);assert.ok(events.includes('core-state'));
});

test('save projection requires complete canonical state and exposes frozen statuses',() => {
  assert.throws(() => createSaveStateController(),/canonical C\+\+ document state/);
  let core={ epoch: 1,checkpoint: 0,presentationCheckpoint: 0,documentDirty: false,presentationDirty: false };
  const owner=createSaveStateController({ getDocumentState: () => core });
  owner.markOpenedFile();assert.equal(owner.snapshot().file,'clean');assert.ok(Object.isFrozen(owner.snapshot()));
  core={ epoch: 2,checkpoint: 1 };assert.throws(owner.snapshot,/complete C\+\+ dirty/);
});
