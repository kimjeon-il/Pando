import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreWorkerRuntime } from "../../shared/frontend/js/modules/core-worker-runtime.js";

const context = { throwIfCancelled() {} };
test('every Worker operation uses one document session and retired timeline transports cannot construct another owner', async () => {
  const calls = [];
  class CoreSession { constructor() { throw new Error('The retired standalone model cannot be constructed.'); } }
  class DocumentSession {
    constructor() { calls.push('document-create'); }
    documentLoad() { calls.push('document-load'); return { epoch: 1,timelineCursor: '2026-10' }; }
    resolveWorld(month,sourceEpoch) { return { month,sourceEpoch,entities: [] }; }
    documentSnapshot() { return {}; }
    selectionSnapshot() { return { items: [],primary: null,hover: null }; }
    draftSnapshot() { return { active: false }; }
    executeCommand() { calls.push('document-execute'); return { ok: true, changed: true, state: { epoch: 2,timelineCursor: '2026-10' }, delta: { timelineRecords: null } }; }
    delete() { calls.push('document-delete'); }
  }
  const runtime = createCoreWorkerRuntime({ loadModule: async () => ({ CoreSession, DocumentSession }), validateFlagDataUrl() {} });
  assert.equal(runtime.operations.includes('core.timeline-load'),false);
  assert.equal(runtime.operations.includes('core.resolve-world'),false);
  await assert.rejects(runtime.dispatch('core.timeline-load', { sourceRevision: 1, source: {} }, context),{ code: 'PL-CORE-OPERATION' });
  await assert.rejects(runtime.dispatch('core.document-state',{},context),{ code: 'PL-CORE-NOT-LOADED' });
  await runtime.dispatch('core.document-load', { storageJson: '{}' }, context);
  await assert.rejects(runtime.dispatch('core.timeline-load', { sourceRevision: 2, source: {} }, context), { code: 'PL-CORE-OPERATION' });
  await runtime.dispatch('core.document-execute', { commandId: 'territorial.field', expectedEpoch: 1, targets: [], payload: {} }, context);
  assert.deepEqual(calls, ['document-create','document-load','document-execute']);
  await runtime.dispose();
  assert.equal(calls.at(-1), 'document-delete');
});
