import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditPreviewController } from '../../assets/js/modules/edit-preview-controller.js';
import { createTestEditingDomain as createEditingDomain } from '../helpers/editing-domain.mjs';
import { createEditingRenderPacket } from '../../assets/js/modules/editing-render-packet.js';
import { calculateEditPreview } from '../../assets/js/modules/map-edit-preview-calculations.js';
import '../../assets/js/vendor/polygon-clipping.min.js';

const segments = [{ start: [0, 0], end: [2, 3] }];
const successor = { kind: 'geometry-preview', sessionId: 'result-b', revision: 4 };

test('pending preview retains the final geographic segments until its successor is presented', () => {
  const preview = createEditPreviewController();
  const id = preview.begin({ key: 'border:A|B', segments, projectGeneration: 2 });
  preview.update([{ start: [1, 1], end: [2, 3] }]);
  assert.equal(preview.waitForResult(id), true);
  assert.deepEqual([...preview.packet().packet.startsEnds], [1, 1, 2, 3]);
  assert.equal(preview.update(segments), false, 'waiting coordinates are frozen');
  assert.equal(preview.snapshot().status, 'pending-result');
  assert.equal(preview.handoff(id, successor), true);
  assert.equal(preview.isActive(), true, 'a result is not a painted frame');
  assert.equal(preview.completeHandoff(id, successor, { frameId: 7, projectGeneration: 2 }), true);
  assert.equal(preview.packet(), null);
});

test('an obsolete result or frame cannot retire a newer preview even when its key repeats', () => {
  const preview = createEditPreviewController();
  const old = preview.begin({ key: 'border:A', segments, projectGeneration: 2 });
  preview.waitForResult(old);
  preview.handoff(old, successor);
  const current = preview.begin({ key: 'border:A', segments, projectGeneration: 3 });
  assert.equal(preview.handoff(old, successor), false);
  assert.equal(preview.completeHandoff(old, successor, { frameId: 8, projectGeneration: 2 }), false);
  assert.equal(preview.clear(old), false);
  assert.equal(preview.snapshot().id, current);
  preview.waitForResult(current);
  preview.handoff(current, successor);
  assert.equal(preview.completeHandoff(current, successor, { frameId: 8, projectGeneration: 2 }), false);
  assert.equal(preview.completeHandoff(current, { ...successor, revision: 3 }, { frameId: 8, projectGeneration: 3 }), false);
  assert.equal(preview.completeHandoff(current, successor, { frameId: 0, projectGeneration: 3 }), false);
  assert.equal(preview.isActive(), true);
});

test('object handoff checks the logical key and exact committed geometry as well as its revision', () => {
  const preview = createEditPreviewController();
  const id = preview.begin({ key: 'hydro:river-1', segments, projectGeneration: 2 });
  const geometry = { type: 'LineString', coordinates: [[1, 1], [2, 3]] };
  const target = { kind: 'object', objectKey: 'hydro:river:river-1', geometry, geometryRevision: 0 };
  preview.waitForResult(id);
  preview.handoff(id, target);
  const frame = { frameId: 9, projectGeneration: 2 };
  assert.equal(preview.completeHandoff(id, { ...target, geometry: structuredClone(geometry) }, frame), false);
  assert.equal(preview.completeHandoff(id, { ...target, objectKey: 'hydro:river:river-2' }, frame), false);
  assert.equal(preview.completeHandoff(id, { ...target, geometryRevision: 1 }, frame), false);
  assert.equal(preview.completeHandoff(id, target, frame), true);
});

function gestureHarness() {
  const preview = createEditPreviewController();
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let editing;
  editing = createEditingDomain({
    previewController: preview,
    transactionRunner: ({ patch }) => patch.commit(),
    draftServices: { screenToCoordinate: value => value },
    geometryEditing: {
      beginBoundaryGesture() {
        const previewId = preview.begin({ key: 'border:A', segments, projectGeneration: 0 });
        return { previewId, changed: true };
      },
      async commitBoundaryGesture(session) {
        const ok = await waiting;
        if (ok instanceof Error) throw ok;
        if (ok) preview.handoff(session.previewId, successor);
        return ok;
      },
    },
  });
  const packet = editing.createRenderPacket();
  const event = type => ({ type, gestureId: 'move-1', projectGeneration: 0, packetRevision: packet.revision });
  editing.handleInteraction(event('boundary-vertex-drag-start'));
  const end = () => editing.handleInteraction(event('boundary-vertex-drag-end'));
  return { editing, preview, release, end };
}

test('drag end does not clear a pending result or a result awaiting its presentation frame', async () => {
  const h = gestureHarness();
  const result = h.end();
  assert.equal(h.preview.snapshot().status, 'pending-result');
  h.release(true);
  assert.equal(await result, true);
  assert.equal(h.preview.snapshot().status, 'successor-ready');
  assert.deepEqual([...h.preview.packet().packet.startsEnds], [0, 0, 2, 3]);
});

for (const action of ['tool-change', 'project-reset', 'dispose']) {
  test(`${action} invalidates a result after mouseup without allowing it to clear a later preview`, async () => {
    const h = gestureHarness();
    const result = h.end();
    if (action === 'tool-change') h.editing.setTool('select');
    if (action === 'project-reset') h.editing.resetProject(1);
    if (action === 'dispose') h.editing.dispose();
    assert.equal(h.preview.isActive(), false);
    const next = h.preview.begin({ key: 'border:A', segments, projectGeneration: 1 });
    h.release(true);
    await result;
    assert.equal(h.preview.snapshot().id, next);
    assert.equal(h.preview.snapshot().status, 'dragging');
  });
}

test('a failed boundary result clears its preview instead of leaving the attempted move painted', async () => {
  const h = gestureHarness();
  const result = h.end();
  h.release(false);
  assert.equal(await result, false);
  assert.equal(h.preview.isActive(), false);
});

test('a thrown commit failure cleans the moved preview and preserves the technical error for its operation boundary', async () => {
  const h = gestureHarness();
  const failure = new Error('production boundary calculation failed');
  const result = h.end();
  h.release(failure);
  await assert.rejects(result, error => error === failure && error.stack.includes('production boundary calculation failed'));
  assert.equal(h.preview.snapshot().status, 'idle');
  h.editing.dispose();
});

test('area-preserving shared border movement carries old and new boundaries through the production preview and packet', () => {
  const feature = (id, ring) => ({ type: 'Feature', id, properties: { entityKind: 'general' }, geometry: { type: 'Polygon', coordinates: [ring] } });
  const before = [feature('west', [[0, 0], [2, 0], [2, 1], [2, 2], [0, 2], [0, 0]]),
    feature('east', [[2, 0], [4, 0], [4, 2], [2, 2], [2, 1], [2, 0]])];
  const after = structuredClone(before);
  after[0].geometry.coordinates[0][2] = [2.25, 1];
  after[1].geometry.coordinates[0][4] = [2.25, 1];
  const preview = calculateEditPreview('boundary', { affectedIds: ['west', 'east'], features: after, removedIds: [] }, before, globalThis.polygonClipping);
  assert.equal(preview.delta.addedGeometry, null);
  assert.equal(preview.delta.removedGeometry, null);
  assert.deepEqual(preview.delta.newBoundaries, after.map(feature => feature.geometry));
  assert.deepEqual(preview.delta.oldBoundaries, before.map(feature => feature.geometry));
  const packet = createEditingRenderPacket({ preview: { sessionId: 'move-shared', revision: 3, status: 'ready', delta: preview.delta } });
  assert.equal(packet.preview.sessionId, 'move-shared');
  assert.equal(packet.preview.revision, 3);
  assert.deepEqual(packet.preview.delta.newBoundaries, after.map(feature => feature.geometry));
  assert.equal(Object.isFrozen(packet.preview.delta.newBoundaries), true);
});
