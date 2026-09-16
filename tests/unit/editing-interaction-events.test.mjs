import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditingDomain } from '../../assets/js/modules/editing-domain.js';

test('insert mode supports repeated single-tap insertion, selected deletion and draft undo', () => {
  let enabled = true;
  const editing = createEditingDomain({ draftServices: {
    getToolConfig: () => enabled ? { shape: 'line' } : null,
    projectCoordinate: value => value, screenToCoordinate: value => value,
  } });
  assert.equal(editing.setDraftVertexInsertMode(true), false);
  editing.replaceDraftCoordinates([[0, 0], [10, 0]], { inputPhase: 'refine' });
  assert.equal(editing.deleteSelectedDraftPoint(), false);
  assert.equal(editing.setDraftVertexInsertMode(true), true);
  assert.equal(editing.createRenderPacket().draft.vertexInsertMode, true);
  assert.equal(editing.handleInteraction(eventFor(editing, 'draft-segment-insert', { segmentIndex: 0, screenPoint: [3, 1] })), true);
  assert.equal(editing.handleInteraction(eventFor(editing, 'draft-segment-insert', { segmentIndex: 1, screenPoint: [7, -1] })), true);
  assert.deepEqual(editing.snapshot().draft.coords, [[0, 0], [3, 0], [7, 0], [10, 0]]);
  assert.equal(editing.snapshot().draft.vertexInsertMode, true);
  editing.deleteSelectedDraftPoint();
  assert.deepEqual(editing.snapshot().draft.coords, [[0, 0], [3, 0], [10, 0]]);
  editing.performDraftUndo();
  assert.equal(editing.snapshot().draft.coords.length, 4);
  editing.setDraftVertexInsertMode(false);
  assert.equal(editing.handleInteraction(eventFor(editing, 'draft-segment-insert', { segmentIndex: 0, screenPoint: [1, 0] })), false);
  editing.setDraftVertexInsertMode(true);
  editing.redrawDraft();
  assert.equal(editing.snapshot().draft.vertexInsertMode, false);
  editing.replaceDraftCoordinates([[0, 0], [10, 0]]);
  enabled = false; // A completed preview disables draft input, including stale handles.
  editing.refreshDraftPresentation('preview-ready');
  assert.equal(editing.createRenderPacket().draft.active, false);
  assert.equal(editing.deleteSelectedDraftPoint(), false);
  assert.equal(editing.handleInteraction(eventFor(editing, 'draft-vertex-select', { vertexIndex: 0 })), false);
  assert.equal(editing.handleInteraction(eventFor(editing, 'draft-vertex-drag-start', { vertexIndex: 0 })), false);
  enabled = true;
  editing.refreshDraftPresentation('preview-discard');
  assert.equal(editing.createRenderPacket().draft.active, true);
});

test('insertion mode includes the closing polygon segment and resets with the draft', () => {
  const editing = createEditingDomain({ draftServices: {
    getToolConfig: () => ({ shape: 'polygon' }),
    projectCoordinate: value => value, screenToCoordinate: value => value,
  } });
  editing.replaceDraftCoordinates([[0, 0], [10, 0], [10, 10]]);
  editing.setDraftVertexInsertMode(true);
  editing.handleInteraction(eventFor(editing, 'draft-segment-insert', { segmentIndex: 2, screenPoint: [5, 5] }));
  assert.deepEqual(editing.snapshot().draft.coords.at(-1), [5, 5]);
  editing.startDraft({ coords: [] });
  assert.equal(editing.snapshot().draft.vertexInsertMode, false);
});

const eventFor = (editing, type, detail = {}) => {
  const packet = editing.createRenderPacket();
  return {
    type,
    projectGeneration: packet.projectGeneration,
    packetRevision: packet.revision,
    ...detail,
  };
};

test('stale click interactions are rejected without changing packet revision', () => {
  const editing = createEditingDomain({
    draftServices: {
      getToolConfig: () => ({ shape: 'line', profile: 'freehand' }),
      projectCoordinate: value => value,
      screenToCoordinate: value => value,
    },
  });
  editing.replaceDraftCoordinates([[0, 0], [10, 0]]);
  const packet = editing.createRenderPacket();
  assert.equal(editing.handleInteraction({
    type: 'draft-vertex-select',
    projectGeneration: packet.projectGeneration + 1,
    packetRevision: packet.revision,
    vertexIndex: 0,
  }), false);
  assert.strictEqual(editing.createRenderPacket(), packet);
});

test('drag move accepts a newer packet revision only for the active gesture id', () => {
  const frames = [];
  const editing = createEditingDomain({
    draftServices: {
      getToolConfig: () => ({ shape: 'line', profile: 'freehand' }),
      screenToCoordinate: value => value,
      projectCoordinate: value => value,
      requestFrame: callback => { frames.push(callback); return frames.length; },
      cancelFrame: () => {},
    },
  });
  editing.replaceDraftCoordinates([[0, 0], [10, 0]]);
  assert.equal(editing.handleInteraction(eventFor(editing, 'draft-vertex-drag-start', {
    gestureId: 'gesture-1', vertexIndex: 0, screenPoint: [0, 0],
  })), true);
  const newerRevision = editing.createRenderPacket().revision;
  assert.equal(editing.handleInteraction({
    type: 'draft-vertex-drag-move', gestureId: 'gesture-1', projectGeneration: 0,
    packetRevision: newerRevision - 1, vertexIndex: 0, screenPoint: [4, 5],
  }), true);
  frames.shift()();
  assert.deepEqual(editing.snapshot().draft.coords[0], [4, 5]);
  assert.equal(editing.handleInteraction({
    type: 'draft-vertex-drag-move', gestureId: 'other', projectGeneration: 0,
    packetRevision: newerRevision, vertexIndex: 0, screenPoint: [8, 9],
  }), true, 'move is queued before gesture validation');
  frames.shift()();
  assert.deepEqual(editing.snapshot().draft.coords[0], [4, 5]);
});

test('project reset cancels an active gesture and rejects its stale end event', async () => {
  const editing = createEditingDomain({
    draftServices: {
      getToolConfig: () => ({ shape: 'line', profile: 'freehand' }),
      screenToCoordinate: value => value,
      projectCoordinate: value => value,
    },
  });
  editing.replaceDraftCoordinates([[0, 0]]);
  const started = eventFor(editing, 'draft-vertex-drag-start', {
    gestureId: 'old-project', vertexIndex: 0, screenPoint: [0, 0],
  });
  assert.equal(editing.handleInteraction(started), true);
  editing.resetProject(2);
  assert.equal(await editing.handleInteraction({
    ...started,
    type: 'draft-vertex-drag-end',
    screenPoint: [2, 2],
  }), false);
  assert.equal(editing.snapshot().projectGeneration, 2);
  assert.deepEqual(editing.snapshot().draft.coords, []);
});
