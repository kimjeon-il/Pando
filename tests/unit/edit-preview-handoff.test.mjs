import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditPreviewController } from '../../assets/js/modules/edit-preview-controller.js';
import { createEditingDomain } from '../../assets/js/modules/editing-domain.js';
import { createEditingRenderPacket } from '../../assets/js/modules/editing-render-packet.js';
import { calculateEditPreview } from '../../assets/js/modules/map-edit-preview-calculations.js';
import { createBoundaryPreparation } from '../../assets/js/modules/boundary-preparation.js';
import { boundaryDragCommitEvidence } from '../helpers/boundary-drag-commit.mjs';
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

test('boundary handoff oracle targets the submitted vertex when mouseup flushes a withheld final RAF move', async () => {
  const source = { type: 'Feature', id: 'A', properties: {}, geometry: { type: 'Polygon',
    coordinates: [[[0, 0], [3, 0], [3, 3], [-1, 3], [-1, 0], [0, 0]]] } };
  const service = createBoundaryPreparation();
  await service.sync([source]);
  const prepared = await service.prepare({ targetIds: ['A'], mode: 'coast' });
  const node = prepared.handles.find(handle => handle.nodeKey === '0,0');
  assert.ok(node && !node.fixed);
  const preview = createEditPreviewController(), frames = [], requests = [];
  let release, result;
  const waiting = new Promise(resolve => { release = resolve; });
  const editing = createEditingDomain({ previewController: preview,
    transactionRunner: ({ patch }) => patch.commit(),
    draftServices: { screenToCoordinate: point => point,
      requestFrame: callback => { frames.push(callback); return frames.length; } },
    geometryEditing: {
      beginBoundaryGesture: () => ({ node, startCoordinate: node.coordinate, coordinate: node.coordinate, changed: false,
        previewId: preview.begin({ key: `coast:A:${node.nodeKey}`, segments: node.segments, projectGeneration: 0 }) }),
      moveBoundaryGesture(session, coordinate) {
        session.changed = true;
        session.coordinate = coordinate.slice();
        const moved = point => point[0] === session.startCoordinate[0] && point[1] === session.startCoordinate[1] ? coordinate : point;
        preview.update(node.segments.map(segment => ({ start: moved(segment.start), end: moved(segment.end) })));
      },
      async commitBoundaryGesture(session) {
        const payload = { preparationId: prepared.preparationId, nodeKey: session.node.nodeKey, coordinate: session.coordinate };
        requests.push({ operation: 'boundary-move', ...structuredClone(payload), previewId: session.previewId,
          packetStatus: preview.snapshot().status, packetRevision: preview.packet().packet.geometryRevision });
        // This is the same production boundary calculation used by the Worker.
        result = service.move(payload);
        await waiting;
        return preview.handoff(session.previewId, successor);
      },
    },
  });
  const event = { projectGeneration: 0, packetRevision: editing.createRenderPacket().revision,
    gestureId: 'withheld-final-raf', vertexKey: node.key };
  const dispatch = (type, screenPoint) => editing.handleInteraction({ ...event, type: `boundary-vertex-drag-${type}`, screenPoint });
  assert.equal(dispatch('start', [0, 0]), true);
  const target = { nodeKey: node.nodeKey, preparationId: prepared.preparationId, previewId: preview.snapshot().id };
  const originalCoordinate = editing.createRenderPacket().boundaryActiveCoordinate;
  assert.equal(dispatch('move', [1, 1]), true);
  frames.shift()();
  assert.equal(dispatch('move', [2, 2]), true);
  const preUpCoordinate = editing.createRenderPacket().boundaryActiveCoordinate;
  assert.deepEqual(preUpCoordinate, [1, 1]);
  assert.deepEqual([...preview.packet().packet.startsEnds], [1, 1, 3, 0, -1, 0, 1, 1]);
  assert.equal(frames.length, 1, 'the final animation callback remains withheld');

  const ended = dispatch('end', [2, 2]);
  const packet = preview.packet().packet;
  const pending = { ...preview.snapshot(), key: packet.key, packetRevision: packet.geometryRevision, coordinates: [...packet.startsEnds] };
  const evidence = boundaryDragCommitEvidence({ target, originalCoordinate, preUpCoordinate, requests, pending });
  assert.deepEqual(requests[0].coordinate, [2, 2], 'the real editing domain flushes the final sample before commit');
  assert.deepEqual(pending.coordinates, [2, 2, 3, 0, -1, 0, 2, 2]);
  assert.equal(preview.update(node.segments), false, 'the direct packet is frozen while the result is held');
  release();
  assert.equal(await ended, true);
  const delta = calculateEditPreview('coast', result, [source], globalThis.polygonClipping).delta;
  const successorPoints = delta.newBoundaries.flatMap(geometry => geometry.coordinates.flat(geometry.type === 'MultiPolygon' ? 2 : 1));
  assert.equal(successorPoints.some(point => Math.hypot(point[0] - preUpCoordinate[0], point[1] - preUpCoordinate[1]) < 0.00002), false,
    'the stale pre-up vertex is absent from the valid production successor');
  assert.deepEqual(evidence.editedCoordinate, [2, 2], 'the handoff target must be the final submitted moved vertex');
  assert.equal(evidence.requestMatchesTarget, true);
  assert.equal(evidence.frozenRequestPacket, true);
  assert.equal(evidence.meaningfulDisplacement, true);
  assert.equal(evidence.packetContainsEditedCoordinate, true);
  assert.ok(successorPoints.some(point => Math.hypot(point[0] - evidence.editedCoordinate[0], point[1] - evidence.editedCoordinate[1]) < 0.00002));
  const inspect = overrides => boundaryDragCommitEvidence({ target, originalCoordinate, preUpCoordinate, requests, pending, ...overrides });
  for (const wrongTarget of [{ nodeKey: '3,0' }, { preparationId: 'other-preparation' }, { previewId: target.previewId + 1 }]) {
    assert.equal(inspect({ target: { ...target, ...wrongTarget } }).requestMatchesTarget, false,
      'another node, preparation or gesture cannot supply the committed target');
  }
  assert.equal(inspect({ pending: { ...pending, packetRevision: 'stale' } }).frozenRequestPacket, false);
  assert.equal(inspect({ pending: { ...pending, status: 'dragging' } }).frozenRequestPacket, false);
  assert.equal(inspect({ originalCoordinate: [2, 2] }).meaningfulDisplacement, false);
  assert.equal(inspect({ pending: { ...pending, coordinates: [1, 1, 3, 0, -1, 0, 1, 1] } }).packetContainsEditedCoordinate, false,
    'a stale direct packet cannot stand in for the final frozen packet');
  assert.equal(inspect({ requests: [] }).requestMatchesTarget, false);
  assert.equal(inspect({ requests: [...requests, requests[0]] }).requestMatchesTarget, false);
  assert.equal(preview.completeHandoff(target.previewId, successor, { frameId: 7, projectGeneration: 0 }), true);
  editing.dispose();
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
