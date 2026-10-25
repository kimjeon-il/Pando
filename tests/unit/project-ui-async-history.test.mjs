import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectUiBridge } from "../../apps/editor/frontend/js/modules/project-ui-bridge.js";

function fixture({ undoProject, redoProject, draftInputActive = () => false, undoDraft, redoDraft,
  getEditingSnapshot = () => ({ processing: false, previewActive: false }), returnToEditing } = {}) {
  const status = [];
  const buttons = new Map(['undoBtn','redoBtn','mobileUndoBtn','mobileRedoBtn'].map(id => [id, { disabled: false, dataset: {}, setAttribute() {}, removeAttribute() {} }]));
  const ui = createProjectUiBridge({ getElement: id => buttons.get(id), getSaveSnapshot: () => ({}),
    getEditingSnapshot, requireCanonicalData: () => true,
    getDraftSnapshot: () => ({ historyCount: 1, futureCount: 1 }), canUndo: () => true, canRedo: () => true,
    draftInputActive, undoDraft, redoDraft, returnToEditing,
    undoProject, redoProject, setActionStatus: (...args) => status.push(args),
  });
  return { ui, status, buttons };
}

test('history UI awaits whole-project undo and keeps a no-op silent', async () => {
  let finish;
  const f = fixture({ undoProject: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.ui.undo();
  assert.deepEqual(f.status, []);
  assert.equal(f.buttons.get('undoBtn').disabled, true);
  finish(false);
  await pending;
  assert.deepEqual(f.status, []);
  assert.equal(f.buttons.get('undoBtn').disabled, false);
});

test('history UI contains a whole-project session error and reports it at the action boundary', async () => {
  const f = fixture({ redoProject: async () => { throw Object.assign(new Error('core history rejected'), { code: 'PL-CORE-STALE' }); } });
  await f.ui.redo();
  assert.equal(f.status.length, 1);
  assert.equal(f.status[0][1], 'error');
  assert.match(f.status[0][0], /core history rejected/);
});

for (const direction of ['undo','redo']) {
  test(`history UI awaits detached draft ${direction} and never travels Project history`, async () => {
    let resolve;
    const acknowledgement = new Promise(accept => { resolve = accept; });
    const f = fixture({ draftInputActive: () => true, undoDraft: () => acknowledgement, redoDraft: () => acknowledgement,
      undoProject: () => assert.fail('Draft Undo cannot travel Project history.'),
      redoProject: () => assert.fail('Draft Redo cannot travel Project history.') });
    const pending = f.ui[direction]();
    assert.equal([...f.buttons.values()].every(button => button.disabled),true);
    assert.deepEqual(f.status,[]);
    resolve(true); await pending;
    assert.equal(f.buttons.get('undoBtn').disabled,false);
    assert.equal(f.buttons.get('redoBtn').disabled,false);
    assert.deepEqual(f.status,[]);
  });
}

test('draft and preview cancellation failures remain inside the history UI operation boundary', async () => {
  for (const previewActive of [false,true]) {
    const error = Object.assign(new Error('Core detached edit failed'), { code: 'PL-CORE-LOAD' });
    const f = fixture({ draftInputActive: () => true, getEditingSnapshot: () => ({ processing: false, previewActive }),
      undoDraft: async () => { throw error; }, returnToEditing: async () => { throw error; } });
    await f.ui.undo();
    assert.equal(f.status.length,1); assert.equal(f.status[0][1],'error');
    assert.match(f.status[0][0],/Core detached edit failed/);
    assert.equal(f.buttons.get('undoBtn').disabled,false);
  }
});
