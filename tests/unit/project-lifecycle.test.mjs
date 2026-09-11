import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectDomain } from '../../assets/js/modules/project-domain.js';
import { createHistoryService } from '../../assets/js/modules/history-service.js';
import { createSaveStateController } from '../../assets/js/modules/save-state-controller.js';

function fixture() {
  const events = [];
  let value = { count: 0 };
  const store = { history: [], historyMeta: [], future: [], futureMeta: [] };
  const saveState = createSaveStateController();
  const history = createHistoryService({
    store, maxEntries: 10, snapshot: () => structuredClone(value),
    restore: (next, options) => {
      events.push(options.mode);
      value = structuredClone(next);
      if (next.fail) throw new Error('restore failed');
    },
    normalizeMetadata: meta => meta,
  });
  const domain = createProjectDomain({
    getSnapshot: () => value,
    history, saveState,
    persistence: {
      cancelPending: () => events.push('cancel-pending'),
      queueProject: (_delay, options) => {
        assert.equal(options.markDirty, false);
        events.push('autosave');
      },
    },
    prepareEmpty: async () => { events.push('prepare'); return { count: 0 }; },
    captureReplacement: () => structuredClone(value),
    replaceSnapshot: (next, { prepared }) => {
      events.push('replace');
      value = structuredClone(next || prepared);
      if (next?.fail) throw new Error('replacement failed');
      return true;
    },
    restoreReplacement: checkpoint => { value = checkpoint; events.push('rollback'); },
    createProjectFile: project => project,
    onProjectReset: () => events.push('reset'),
    onProjectChanged: () => events.push('event'),
    invalidateProject: () => events.push('render'),
    invalidateHistory: () => events.push('render'),
  });
  return { domain, store, saveState, events };
}

test('load/new commit event, render and autosave once after replacement; save state stays clean', async () => {
  const { domain, store, saveState, events } = fixture();
  domain.recordHistory();
  await domain.load({ count: 3 });
  assert.deepEqual(events, ['cancel-pending', 'reset', 'replace', 'event', 'render', 'autosave']);
  assert.equal(store.history.length, 0);
  assert.equal(saveState.snapshot().hasUnsavedChanges, false);
  events.length = 0;
  await domain.createEmpty();
  assert.deepEqual(events, ['prepare', 'cancel-pending', 'reset', 'replace', 'event', 'render', 'autosave']);
  assert.deepEqual(domain.snapshot(), { count: 0 });
  assert.equal(saveState.snapshot().file, 'never-saved');
});

test('failed replacement restores canonical state and preserves history without success effects', async () => {
  const { domain, store, events } = fixture();
  domain.recordHistory();
  await assert.rejects(domain.load({ fail: true }), /replacement failed/);
  assert.deepEqual(domain.snapshot(), { count: 0 });
  assert.equal(store.history.length, 1);
  assert.equal(domain.getGeneration(), 2, 'failed worker generations cannot become current again');
  assert.deepEqual(events, ['cancel-pending', 'reset', 'replace', 'reset', 'rollback']);
});

test('undo/redo emit one lifecycle sequence; empty history has no effects', () => {
  const { domain, events } = fixture();
  assert.equal(domain.undo(), false);
  assert.deepEqual(events, []);
  domain.recordHistory();
  assert.equal(domain.undo(), true);
  assert.deepEqual(events, ['history', 'event', 'render', 'autosave']);
  events.length = 0;
  assert.equal(domain.redo(), true);
  assert.deepEqual(events, ['history', 'event', 'render', 'autosave']);
});

test('failed history restore rolls back without moving history stacks or scheduling effects', () => {
  const { domain, store, events } = fixture();
  domain.commitHistorySnapshot({ fail: true });
  assert.throws(() => domain.undo(), /restore failed/);
  assert.deepEqual(domain.snapshot(), { count: 0 });
  assert.equal(store.history.length, 1);
  assert.equal(store.future.length, 0);
  assert.deepEqual(events, ['history', 'rollback']);
});

test('save owns status, cancellation, and detached export without history/render/autosave', async () => {
  const { domain, saveState, events } = fixture();
  saveState.markContentChanged();
  const before = saveState.checkpoint();
  await assert.rejects(domain.save(() => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }); }));
  assert.deepEqual(saveState.checkpoint(), before);
  assert.equal(await domain.save(project => {
    project.count = 99;
    return { downloaded: true };
  }), true);
  assert.deepEqual(domain.snapshot(), { count: 0 });
  assert.equal(saveState.snapshot().file, 'download-created');
  assert.deepEqual(events, []);
});

test('edits made while exporting are not marked saved; duplicate saves do not run', async () => {
  const { domain, saveState } = fixture();
  let finish;
  const pending = domain.save(() => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  assert.equal(await domain.save(() => assert.fail('duplicate writer')), false);
  saveState.markPresentationChanged();
  finish({ downloaded: false });
  await pending;
  assert.equal(saveState.snapshot().hasUnsavedChanges, true);
  assert.equal(saveState.snapshot().file, 'dirty');
});
