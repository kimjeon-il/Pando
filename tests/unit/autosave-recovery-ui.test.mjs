import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { createProjectUiBridge } from '../../assets/js/modules/project-ui-bridge.js';
import { createPersistenceService } from '../../assets/js/modules/persistence-service.js';

function fixture({ archive = async () => {} } = {}) {
  const modals = [];
  const saved = { db: { name: 'database' }, local: { name: 'fallback' }, recovery: [] };
  const elements = new Map(['projectSaveStatus', 'projectSaveStatusText', 'autosaveRecoveryBtn'].map(id =>
    [id, { hidden: true, dataset: {}, setAttribute() {}, addEventListener(_name, callback) { this.click = callback; } }]));
  let current = { name: 'default' };
  let dirty = false;
  let paused = false;
  let contentToken = 0;
  const service = createPersistenceService({
    storage: { readProject: async () => saved.db, readView: async () => null, readFallback: () => saved.local,
      writeProject: async value => { saved.db = value; }, writeFallback: value => { saved.local = value; },
      removeFallback: () => { saved.local = null; }, writeRecovery: async value => { await archive(); saved.recovery.push(value); } },
    scheduler: { scheduleIdle() {}, cancel() {} }, canPersist: () => true, buildAutosave: () => current,
    validateProject() {}, onDirty() {}, onAutosaveState() {}, onSaved() {}, onFailure() {},
    onRecoveryState: value => { paused = !!value; },
  });
  const bridge = createProjectUiBridge({ getElement: id => elements.get(id),
    getSaveSnapshot: () => ({ autosaveRecovery: paused, hasUnsavedChanges: dirty, currentContentToken: contentToken }),
    getProjectGeneration: () => 0,
    getEditingSnapshot: () => ({}), draftInputActive: () => false, requireCanonicalData: () => true,
    openConfirmModal: options => modals.push(options), setActionStatus() {},
    getAutosaveRecovery: service.getRecovery, restoreAutosave: service.restore,
    resolveAutosaveRecovery: service.resolveRecovery, loadAutosave: async value => { current = value; },
    completeAutosaveRecovery: service.completeRecovery,
    queueAutosave: () => service.queueProject(),
  });
  return { bridge, service, saved, modals, elements, current: () => current,
    dirty: () => { dirty = true; contentToken++; } };
}

test('edits made while recovery archival is pending prevent replacing the current work', async () => {
  let release;
  const f = fixture({ archive: () => new Promise(resolve => { release = resolve; }) });
  await f.service.restore();
  const retry = f.bridge.requestAutosaveRecovery();
  f.modals.shift().onConfirm('localstorage');
  await new Promise(resolve => setImmediate(resolve));
  f.dirty();
  release();
  await retry;
  assert.equal(f.current().name, 'default');
  assert.equal(f.saved.db.name, 'database');
  assert.equal(f.service.getRecovery().kind, 'conflict');
});

test('startup selection stays paused until the restored project has actually been applied', async () => {
  const f = fixture();
  const startup = f.bridge.restoreAutosave();
  await new Promise(resolve => setImmediate(resolve));
  f.modals.shift().onConfirm('localstorage');
  assert.equal((await startup).project.name, 'fallback');
  assert.ok(f.service.getRecovery());
  await f.service.writeProject({ name: 'before application' });
  assert.equal(f.saved.db.name, 'database');
  await f.bridge.completeAutosaveRecovery();
  assert.equal(f.service.getRecovery(), null);
  assert.equal(f.saved.db.name, 'fallback');
});

test('startup cancel preserves both saves and later selection confirms replacement and archives the other', async () => {
  const f = fixture();
  const startup = f.bridge.restoreAutosave();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.modals.length, 1);
  f.modals.shift().onCancel();
  assert.equal((await startup).project, null);
  f.bridge.syncSaveStatus();
  assert.equal(f.elements.get('autosaveRecoveryBtn').hidden, false);
  assert.equal(f.elements.get('projectSaveStatusText').textContent, '자동저장 중지');
  await f.service.writeProject({ name: 'unload' });
  assert.equal(f.saved.db.name, 'database');
  f.dirty();
  const retry = f.bridge.requestAutosaveRecovery();
  await new Promise(resolve => setImmediate(resolve));
  f.modals.shift().onConfirm('localstorage');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.modals[0].danger, true);
  assert.equal(f.current().name, 'default');
  f.modals.shift().onConfirm();
  await retry;
  assert.equal(f.current().name, 'fallback');
  assert.equal(f.saved.recovery[0].candidates[0].project.name, 'database');
  assert.equal(f.elements.get('autosaveRecoveryBtn').hidden, true);
});
