import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_COMMAND_KINDS,
  createProjectCommandPipeline,
} from '../../assets/js/modules/project-command-pipeline.js';

function fixture(commandFactory = () => ({})) {
  const calls = [];
  const state = { revision: 0, value: 1 };
  const history = [];
  const historySnapshots = [];
  let capturedSnapshot = null;
  const commands = commandFactory({ calls, state, history });
  const pipeline = createProjectCommandPipeline({
    commands,
    captureSnapshot: () => {
      capturedSnapshot = structuredClone(state);
      calls.push('snapshot');
      return capturedSnapshot;
    },
    restoreSnapshot: snapshot => { calls.push('restore'); Object.assign(state, snapshot); },
    recordHistory: (meta, snapshot) => {
      calls.push('history');
      history.push(meta);
      historySnapshots.push(snapshot);
    },
    discardHistory: () => { calls.push('discard-history'); history.pop(); },
    validateProject: () => { calls.push('validate-project'); return true; },
    advanceRevision: () => { calls.push('revision'); state.revision += 1; return state.revision; },
    invalidateRender: dirty => calls.push(`render:${dirty}`),
    queueAutosave: () => calls.push('autosave'),
  });
  return { pipeline, state, calls, history, historySnapshots, capturedSnapshot: () => capturedSnapshot };
}

test('document commands own history, validation, revision, render and autosave order', () => {
  const { pipeline, state, calls, history, historySnapshots, capturedSnapshot } = fixture(({ calls: events, state: model }) => ({
    'value.set': {
      kind: PROJECT_COMMAND_KINDS.DOCUMENT,
      history: (_context, payload) => ({ type: 'value-set', affectedIds: [String(payload)] }),
      execute: (_context, payload) => { events.push('mutate'); model.value = payload; return { changed: true }; },
      renderDirty: 'document',
    },
  }));
  const result = pipeline.execute('value.set', {}, 7);
  assert.equal(result.ok, true);
  assert.equal(state.value, 7);
  assert.equal(state.revision, 1);
  assert.deepEqual(calls, ['snapshot', 'history', 'mutate', 'validate-project', 'revision', 'render:document', 'autosave']);
  assert.equal(history.length, 1);
  assert.equal(history[0].command, 'value.set');
  assert.strictEqual(historySnapshots[0], capturedSnapshot(), 'history must receive the exact pre-mutation snapshot');
});

test('failed document mutation restores the snapshot and discards history', () => {
  const { pipeline, state, calls, history } = fixture(({ calls: events, state: model }) => ({
    'value.fail': {
      execute: () => { events.push('mutate'); model.value = 9; throw new Error('boom'); },
      renderDirty: 'document',
    },
  }));
  const result = pipeline.execute('value.fail');
  assert.equal(result.ok, false);
  assert.equal(state.value, 1);
  assert.equal(state.revision, 0);
  assert.equal(history.length, 0);
  assert.deepEqual(calls, ['snapshot', 'history', 'mutate', 'restore', 'discard-history']);
});

test('view commands never create history, revision or autosave work', () => {
  const { pipeline, state, calls, history } = fixture(({ calls: events }) => ({
    'map.focus': {
      kind: PROJECT_COMMAND_KINDS.VIEW,
      execute: () => { events.push('focus'); return { changed: true }; },
      renderDirty: null,
    },
  }));
  const result = pipeline.execute('map.focus');
  assert.equal(result.ok, true);
  assert.equal(state.revision, 0);
  assert.equal(history.length, 0);
  assert.deepEqual(calls, ['focus']);
});

test('runMutation supplies the production mutation boundary used by domain services', () => {
  const { pipeline, state, calls } = fixture();
  const result = pipeline.runMutation({ type: 'service-edit', affectedIds: ['a'] }, () => {
    calls.push('mutate');
    state.value = 4;
  });
  assert.equal(result.ok, true);
  assert.equal(state.value, 4);
  assert.equal(state.revision, 1);
  assert.deepEqual(calls, ['snapshot', 'history', 'mutate', 'validate-project', 'revision', 'render:document', 'autosave']);
});

test('unchanged document mutations leave no history, revision, render, or autosave state', () => {
  const { pipeline, state, calls, history } = fixture();
  const result = pipeline.runMutation({ type: 'service-noop' }, () => ({ changed: false }), {
    renderDirty: { domain: 'generic', change: 'metadata' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(state.revision, 0);
  assert.equal(history.length, 0);
  assert.deepEqual(calls, ['snapshot', 'history', 'discard-history']);
});

test('autosave failure is non-critical after canonical mutation is committed', () => {
  const state = { revision: 0, value: 1 };
  const pipeline = createProjectCommandPipeline({
    commands: {
      edit: { execute: () => { state.value = 2; }, renderDirty: null },
    },
    captureSnapshot: () => structuredClone(state),
    restoreSnapshot: snapshot => Object.assign(state, snapshot),
    recordHistory: () => {},
    discardHistory: () => {},
    advanceRevision: () => ++state.revision,
    queueAutosave: () => { throw new Error('storage'); },
  });
  const result = pipeline.execute('edit');
  assert.equal(result.ok, true);
  assert.equal(state.value, 2);
  assert.equal(state.revision, 1);
  assert.match(result.autosaveError.message, /storage/);
});

test('render failure is non-critical after canonical mutation is committed', () => {
  const state = { revision: 0, value: 1 };
  const pipeline = createProjectCommandPipeline({
    commands: {
      edit: { execute: () => { state.value = 2; }, renderDirty: { domain: 'generic' } },
    },
    captureSnapshot: () => structuredClone(state),
    restoreSnapshot: snapshot => Object.assign(state, snapshot),
    recordHistory: () => {},
    discardHistory: () => {},
    advanceRevision: () => ++state.revision,
    invalidateRender: () => { throw new Error('renderer'); },
  });
  const result = pipeline.execute('edit');
  assert.equal(result.ok, true);
  assert.equal(state.value, 2);
  assert.equal(state.revision, 1);
  assert.match(result.renderError.message, /renderer/);
});

test('project validation failure restores state before revision, render, or autosave', () => {
  const calls = [];
  const state = { revision: 0, value: 1 };
  const pipeline = createProjectCommandPipeline({
    commands: {
      edit: { execute: () => { calls.push('mutate'); state.value = 2; }, renderDirty: 'document' },
    },
    captureSnapshot: () => structuredClone(state),
    restoreSnapshot: snapshot => { calls.push('restore'); Object.assign(state, snapshot); },
    recordHistory: () => calls.push('history'),
    discardHistory: () => calls.push('discard-history'),
    validateProject: () => { calls.push('validate-project'); return false; },
    advanceRevision: () => { calls.push('revision'); return ++state.revision; },
    invalidateRender: () => calls.push('render'),
    queueAutosave: () => calls.push('autosave'),
  });
  const result = pipeline.execute('edit');
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'validate-project');
  assert.deepEqual(state, { revision: 0, value: 1 });
  assert.deepEqual(calls, ['history', 'mutate', 'validate-project', 'restore', 'discard-history']);
});
