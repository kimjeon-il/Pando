import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDraftRenderPacket,
  createEditingRenderPacket,
  EMPTY_EDITING_RENDER_PACKET,
} from '../../assets/js/modules/editing-render-packet.js';
import { createEditingDomain } from '../../assets/js/modules/editing-domain.js';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';

const assertDeepFrozen = value => {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const item of Object.values(value)) assertDeepFrozen(item);
};

test('asynchronous territory results replace cached packets and clear on cancellation', () => {
  const requests = [];
  let territoryOperation = null;
  const editing = createEditingDomain({
    context: { requestRender: request => requests.push(request) },
    geometryEditing: { renderPacket: () => ({ territoryOperation }) },
  });
  editing.setTool('annex-territory');
  const loading = editing.createRenderPacket();
  territoryOperation = { kind: 'annex-territory', phase: 'components', components: [{ key: 'north', selected: false }] };
  requests.length = 0;
  assert.equal(editing.refreshTerritoryOperation('river-partition-ready'), true);
  const ready = editing.createRenderPacket();
  assert.notEqual(ready, loading);
  assert.equal(ready.revision, loading.revision + 1);
  assert.equal(ready.territoryOperation.components[0].key, 'north');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, 'editing-overlays');
  assert.equal(editing.createRenderPacket(), ready);
  territoryOperation = null;
  editing.refreshTerritoryOperation('river-partition-error');
  assert.equal(editing.createRenderPacket().territoryOperation, null);
  editing.setTool('select');
  requests.length = 0;
  assert.equal(editing.refreshTerritoryOperation('stale-river-partition-ready'), false);
  assert.equal(requests.length, 0);
});

test('editing render packets detach and freeze every public channel', () => {
  const coordinate = [1, 2];
  const source = {
    active: true,
    shape: 'line',
    geometry: { type: 'LineString', coordinates: [coordinate, [3, 4]] },
    vertices: [{ key: 'draft:0', index: 0, coordinate }],
    segments: [{ segmentIndex: 0, start: coordinate, end: [3, 4] }],
    issues: [{ kind: 'invalid', message: 'problem', coordinate }],
  };
  const packet = createEditingRenderPacket({
    revision: 3,
    projectGeneration: 7,
    draft: source,
    preview: { session: { segments: [[coordinate, [3, 4]]] } },
  });
  coordinate[0] = 99;
  source.vertices.push({ key: 'late', coordinate: [5, 6] });
  assert.deepEqual(packet.draft.vertices[0].coordinate, [1, 2]);
  assert.equal(packet.draft.vertices.length, 1);
  assertDeepFrozen(packet);
  assertDeepFrozen(EMPTY_EDITING_RENDER_PACKET);
});

test('draft packet normalizes semantic values without retaining source arrays', () => {
  const values = [[10, 20], [30, 40]];
  const packet = createDraftRenderPacket({
    active: true,
    shape: 'polygon',
    vertices: values.map((value, index) => ({ index, coordinate: value })),
    snapPoints: [{ endpoint: 'start', kind: 'boundary', coordinate: values[0] }],
  });
  values[0][0] = -1;
  assert.deepEqual(packet.vertices[0].coordinate, [10, 20]);
  assert.deepEqual(packet.snapPoints[0].coordinate, [10, 20]);
  assertDeepFrozen(packet);
});

test('editing domain reuses packet identity until an actual state mutation', () => {
  let invalidations = 0;
  const editing = createEditingDomain({
    context: { requestRender: () => { invalidations += 1; } },
    draftServices: {
      getToolConfig: () => ({ shape: 'line', profile: 'freehand', minimumPoints: 2 }),
      screenToCoordinate: value => value,
    },
  });
  const initial = editing.createRenderPacket();
  assert.strictEqual(editing.createRenderPacket(), initial);
  assert.equal(editing.appendDraftScreenPoint([1, 2]), true);
  const changed = editing.createRenderPacket();
  assert.notStrictEqual(changed, initial);
  assert.strictEqual(editing.createRenderPacket(), changed);
  assert.equal(editing.appendDraftScreenPoint([1, 2], 'mouse', { dedupe: true }), false);
  assert.strictEqual(editing.createRenderPacket(), changed);
  assert.equal(invalidations, 1);
});

test('one coordinator frame reads one editing packet for every editing pass', () => {
  const frames = [];
  const packet = createEditingRenderPacket({ revision: 4, projectGeneration: 2 });
  let reads = 0;
  const rendering = createRenderingDomain({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    prepareView: () => ({ revision: 9, projection: 'flat' }),
    getEditingRenderPacket: () => { reads += 1; return packet; },
  });
  assert.equal(rendering.requestRender({ kind: 'editing-overlays', reason: 'packet-contract' }), true);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(reads, 1);
  rendering.dispose();
});
