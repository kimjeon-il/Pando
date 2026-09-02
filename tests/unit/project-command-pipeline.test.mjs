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
  const commands = commandFactory({ calls, state, history });
  const pipeline = createProjectCommandPipeline({
    commands,
    captureSnapshot: () => structuredClone(state),
    restoreSnapshot: snapshot => { calls.push('restore'); Object.assign(state, snapshot); },
    recordHistory: meta => { calls.push('history'); history.push(meta); },
    discardHistory: () => { calls.push('discard-history'); history.pop(); },
    validateProject: () => { calls.push('validate-project'); return true; },
    advanceRevision: () => { calls.push('revision'); state.revision += 1; return state.revision; },
    invalidateRender: dirty => calls.push(`render:${dirty}`),
    queueAutosave: () => calls.push('autosave'),
  });
  return { pipeline, state, calls, history };
}

test('document commands own history, validation, revision, render and autosave order', () => {
  const { pipeline, state, calls, history } = fixture(({ calls: events, state: model }) => ({
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
  assert.deepEqual(calls, ['history', 'mutate', 'validate-project', 'revision', 'render:document', 'autosave']);
  assert.equal(history.length, 1);
  assert.equal(history[0].command, 'value.set');
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
  assert.deepEqual(calls, ['history', 'mutate', 'restore', 'discard-history']);
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

test('runMutation supplies the compatibility bridge used by domain services', () => {
  const { pipeline, state, calls } = fixture();
  const result = pipeline.runMutation({ type: 'service-edit', affectedIds: ['a'] }, () => {
    calls.push('mutate');
    state.value = 4;
  });
  assert.equal(result.ok, true);
  assert.equal(state.value, 4);
  assert.equal(state.revision, 1);
  assert.deepEqual(calls, ['history', 'mutate', 'validate-project', 'revision', 'render:document', 'autosave']);
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
