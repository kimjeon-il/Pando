import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDraftRenderPacket,
  createEditingRenderPacket,
  EMPTY_EDITING_RENDER_PACKET,
  freezeEditingGeometry,
} from '../../assets/js/modules/editing-render-packet.js';
import { createEditingDomain } from '../../assets/js/modules/editing-domain.js';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';

const assertDeepFrozen = value => {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const item of Object.values(value)) assertDeepFrozen(item);
};

test('worker split results without presentation keys remain two distinct render entries', () => {
  const packet = createDraftRenderPacket({ splitCandidates: [{ geometry: null, area: 1 }, { geometry: null, area: 2 }] });
  assert.equal(new Set(packet.splitCandidates.map(candidate => candidate.key)).size, 2);
});

test('validated preview geometry reaches the render packet without another coordinate copy', () => {
  const transferred = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] };
  freezeEditingGeometry(transferred);
  const packet = createEditingRenderPacket({ preview: { status: 'ready', delta: { addedGeometry: transferred } } });
  assert.equal(packet.preview.delta.addedGeometry, transferred);
  assertDeepFrozen(packet.preview);
});

test('asynchronous territory results replace cached packets for every active territory tool', () => {
  for (const tool of ['annex-territory', 'new-country', 'draw-territorial-unit']) {
    const requests = [];
    let territoryOperation = null;
    const editing = createEditingDomain({
      context: { requestRender: request => requests.push(request) },
      geometryEditing: { renderPacket: () => ({ territoryOperation }) },
    });
    editing.setTool(tool);
    const loading = editing.createRenderPacket();
    territoryOperation = { kind: tool, phase: 'components', components: [{ key: 'north', selected: false }] };
    requests.length = 0;
    assert.equal(editing.refreshTerritorySelection({ tool, reason: 'river-partition-ready' }), true);
    const ready = editing.createRenderPacket();
    assert.notEqual(ready, loading);
    assert.equal(ready.revision, loading.revision + 1);
    assert.equal(ready.territoryOperation.components[0].key, 'north');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, 'editing-overlays');
    assert.equal(editing.createRenderPacket(), ready);
    territoryOperation = null;
    editing.refreshTerritorySelection({ tool, reason: 'river-partition-error' });
    assert.equal(editing.createRenderPacket().territoryOperation, null);
    requests.length = 0;
    assert.equal(editing.refreshTerritorySelection({ tool: 'stale-tool', reason: 'stale-river-partition-ready' }), false);
    assert.equal(requests.length, 0);
  }
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

test('inactive draft hides render and feedback channels without losing coordinates or undo history', () => {
  for (const shape of ['line', 'polygon']) {
    let stage = 'selection';
    const editing = createEditingDomain({
      draftServices: {
        getToolConfig: () => stage === 'selection' ? { shape } : null,
        screenToCoordinate: value => value,
        projectCoordinate: value => value,
        assessDraft: ({ coords }) => ({
          line: coords,
          valid: false,
          status: 'invalid',
          issues: [{ kind: 'invalid', coordinate: coords[0], message: '경계를 여러 번 가로지릅니다.' }],
          snaps: { start: { kind: 'boundary', coordinate: coords[0] } },
          splitPreview: { candidates: [{ geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] } }] },
        }),
      },
    });
    editing.setTool('annex-territory');
    for (const point of [[0, 0], [10, 0], [10, 10]]) editing.appendDraftScreenPoint(point);
    editing.performDraftUndo();
    editing.handleInteraction({
      type: 'draft-hover-move', screenPoint: [12, 12],
      packetRevision: editing.createRenderPacket().revision, projectGeneration: 0,
    });
    const before = editing.snapshot().draft;
    const visible = editing.createRenderPacket().draft;
    assert.ok(before.hover);
    assert.ok(before.cutAssessment);
    assert.ok(visible.geometry);
    assert.ok(visible.vertices.length);
    assert.ok(visible.issues.length);
    assert.ok(visible.snapPoints.length);
    assert.ok(visible.splitCandidates.length);
    assert.ok(before.historyCount);
    assert.equal(before.futureCount, 1);

    stage = 'setup';
    editing.refreshTerritorySelection({ tool: 'annex-territory', reason: 'back-setup' });
    const hidden = editing.snapshot().draft;
    assert.equal(hidden.active, false);
    assert.deepEqual(editing.createRenderPacket().draft, EMPTY_EDITING_RENDER_PACKET.draft);
    for (const key of ['coords', 'selectedVertexIndex', 'inputPhase', 'historyCount', 'futureCount']) {
      assert.deepEqual(hidden[key], before[key], `${shape}: ${key} must be preserved`);
    }
    assert.equal(hidden.hover, null);
    assert.equal(hidden.insertTarget, null);
    assert.equal(hidden.dragging, false);
    assert.deepEqual(hidden.issues, []);
    assert.equal(hidden.cutAssessment, null);
    assert.equal(hidden.activeSnap, null);

    stage = 'selection';
    editing.refreshTerritorySelection({ tool: 'annex-territory', reason: 'resume-selection' });
    assert.equal(editing.snapshot().draft.active, true);
    assert.deepEqual(editing.createRenderPacket().draft, visible);
    assert.equal(editing.performDraftRedo(), true);
    assert.deepEqual(editing.snapshot().draft.coords, [[0, 0], [10, 0], [10, 10]]);
    editing.dispose();
  }
});

test('renderer clears inactive draft channels but still draws territory components and candidates', () => {
  const joins = new Map();
  const selection = {};
  for (const method of ['exit', 'enter', 'remove', 'append', 'attr', 'style', 'on', 'each', 'call']) {
    selection[method] = () => selection;
  }
  const layer = { selectAll: selector => ({
    ...selection,
    data: data => { joins.set(selector, data); return selection; },
  }) };
  const frames = [];
  let frameId = 0;
  const shape = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
  let packet = createEditingRenderPacket({ draft: {
    active: true, geometry: shape,
    vertices: [{ index: 0, coordinate: [0, 0] }],
    segments: [{ segmentIndex: 0, start: [0, 0], end: [1, 1] }],
    issues: [{ kind: 'invalid', coordinate: [0, 0] }],
    snapPoints: [{ endpoint: 'start', coordinate: [0, 0] }],
    splitCandidates: [{ geometry: shape }],
  } });
  const rendering = createRenderingDomain({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    prepareView: () => ({ frameId: ++frameId, projection: 'flat' }),
    getEditingRenderPacket: () => packet,
    interactionResources: { draftLayer: layer },
  });
  const render = () => { rendering.invalidateEditingOverlays('inactive-draft-test'); frames.shift()(); };
  render();
  assert.equal(joins.get('g.draft-vertex').length, 1);
  assert.equal(joins.get('path.draft-packet-shape').length, 1);

  // Deliberately invalid input: inactive draft still carries old visual data.
  packet = createEditingRenderPacket({ draft: { ...packet.draft, active: false }, territoryOperation: {
    kind: 'annex-territory', phase: 'components',
    components: [{ key: 'north', geometry: shape, usesRiverBoundary: true, riverBoundarySegments: [[[0, 0], [1, 1]]] }],
    candidates: [{ key: 'candidate', geometry: shape }],
  } });
  render();
  for (const selector of ['g.draft-vertex', 'path.draft-packet-shape', 'path.draft-segment-hit',
    'g.draft-issue-marker', 'circle.draft-snap-point', 'path.draft-split-preview']) {
    assert.deepEqual(joins.get(selector), [], `${selector} must be cleared`);
  }
  assert.equal(joins.get('path.territory-component').length, 1);
  assert.equal(joins.get('path.territory-candidate').length, 1);
  assert.equal(joins.get('path.river-partition-emphasis').length, 1);
  rendering.dispose();
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

test('object selection and deselection refresh vertex packets without an active draft', () => {
  let target = null;
  const editing = createEditingDomain({ geometryEditing: { getObjectVertexTarget: () => target } });
  assert.equal(editing.createRenderPacket().objectVertices, null);
  target = { targetRef: { domain: 'hydro', type: 'river', id: 'river-1' }, mode: 'hydro',
    feature: { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } } };
  assert.equal(editing.refreshEditingPresentation('selection-target'), true);
  assert.equal(editing.createRenderPacket().objectVertices.handles.length, 2);
  target = null;
  assert.equal(editing.refreshEditingPresentation('selection-target'), true);
  assert.equal(editing.createRenderPacket().objectVertices, null);
  editing.dispose();
});
