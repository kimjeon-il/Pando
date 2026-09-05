import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditingDomain } from '../../assets/js/modules/editing-domain.js';

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
  editing.appendDraftCoordinate([0, 0]);
  editing.appendDraftCoordinate([10, 0]);
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
  editing.appendDraftCoordinate([0, 0]);
  editing.appendDraftCoordinate([10, 0]);
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
  editing.appendDraftCoordinate([0, 0]);
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
