import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditingDomain } from '../../assets/js/modules/editing-domain.js';

test('object vertex gesture keeps canonical geometry detached until one commit', async () => {
  const source = {
    type: 'Feature', id: 'river-1', properties: {},
    geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] },
  };
  const frames = [];
  const commits = [];
  const editing = createEditingDomain({
    transactionRunner: ({ patch }) => patch.commit(),
    draftServices: {
      screenToCoordinate: value => value,
      projectCoordinate: value => value,
      requestFrame: callback => { frames.push(callback); return frames.length; },
      cancelFrame: () => {},
    },
    geometryEditing: {
      getObjectVertexTarget: () => ({
        targetRef: { domain: 'hydro', type: 'hydro', id: source.id }, mode: 'hydro', feature: source,
      }),
      resolveObjectFeature: () => source,
      commitObjectGesture: transaction => { commits.push(transaction); return true; },
    },
  });
  const packet = editing.createRenderPacket();
  const base = {
    projectGeneration: packet.projectGeneration,
    packetRevision: packet.revision,
    gestureId: 'object-drag-1',
    targetRef: { domain: 'hydro', type: 'hydro', id: source.id },
    vertexKey: '0:0',
    vertexIndex: 0,
  };
  assert.equal(editing.handleInteraction({ ...base, type: 'object-vertex-drag-start', screenPoint: [0, 0] }), true);
  assert.equal(editing.handleInteraction({ ...base, type: 'object-vertex-drag-move', screenPoint: [4, 5] }), true);
  frames.shift()();
  assert.deepEqual(source.geometry.coordinates[0], [0, 0], 'canonical source is untouched during preview');
  assert.deepEqual(editing.createRenderPacket().objectVertices.handles[0].coordinate, [4, 5]);
  assert.equal(await editing.handleInteraction({ ...base, type: 'object-vertex-drag-end', screenPoint: [4, 5] }), true);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].beforeGeometry.coordinates[0], [0, 0]);
  assert.deepEqual(commits[0].feature.geometry.coordinates[0], [4, 5]);
});

test('cancelled object gesture never commits its detached preview', () => {
  const source = {
    type: 'Feature', id: 'area-1', properties: {},
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  };
  let commits = 0;
  const editing = createEditingDomain({
    transactionRunner: ({ patch }) => patch.commit(),
    draftServices: { screenToCoordinate: value => value, projectCoordinate: value => value },
    geometryEditing: {
      getObjectVertexTarget: () => ({ targetRef: { domain: 'generic', type: 'generic', id: source.id }, mode: 'generic', feature: source }),
      resolveObjectFeature: () => source,
      commitObjectGesture: () => { commits += 1; },
    },
  });
  const packet = editing.createRenderPacket();
  assert.equal(editing.handleInteraction({
    type: 'object-vertex-drag-start', projectGeneration: packet.projectGeneration,
    packetRevision: packet.revision, gestureId: 'cancel-me', targetRef: { domain: 'generic', id: source.id },
    vertexKey: '0:0', vertexIndex: 0, screenPoint: [0, 0],
  }), true);
  assert.equal(editing.cancelActiveGesture('pointercancel'), true);
  assert.equal(commits, 0);
  assert.deepEqual(source.geometry.coordinates[0], [0, 0]);
});
