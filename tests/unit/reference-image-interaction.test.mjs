import assert from 'node:assert/strict';
import test from 'node:test';

import { createReferenceImageInteraction } from '../../assets/js/modules/reference-image-interaction.js';

function classListStub() {
  const values = new Set();
  return {
    add: (...items) => items.forEach(item => values.add(item)),
    remove: (...items) => items.forEach(item => values.delete(item)),
    contains: item => values.has(item),
    values,
  };
}

function createHarness(overrides = {}) {
  const classList = classListStub();
  const mapElement = {
    classList,
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const record = {
    id: 'ref-a',
    locked: false,
    mapQuad: [[0, 10], [20, 10], [20, 0], [0, 0]],
    anchor: null,
    controlPoints: [],
    cornerPinEnabled: false,
    warp: { ok: false, minimumPoints: 2, pointCount: 0 },
  };
  const records = [record];
  const calls = {
    renders: 0,
    persists: 0,
    refreshes: 0,
    editorRenders: 0,
    history: 0,
    gestures: [],
    hints: [],
  };
  const renderer = {
    requestRender() { calls.renders += 1; },
    hitTestUv() { return [0.25, 0.5]; },
    hitTestControlPoint() { return null; },
  };
  const surface = {
    setEditing(active, hint) { calls.editing = { active, hint }; },
    setGestureActive(active) { calls.gestures.push(active); },
  };
  const host = {
    project([lon, lat]) { return [100 + lon * 10, 200 - lat * 10]; },
    unproject([x, y]) { return [(x - 100) / 10, (200 - y) / 10]; },
  };
  const history = { push() { calls.history += 1; } };
  const rebuildWarp = item => {
    item.warp = overrides.rebuildWarp?.(item) || { ok: false, minimumPoints: 2, pointCount: item.controlPoints.length };
  };
  const interaction = createReferenceImageInteraction({
    mapElement,
    records,
    selected: () => records[0] || null,
    renderer,
    getMapHost: () => host,
    getSurface: () => surface,
    cancelTools: () => { calls.cancelTools = (calls.cancelTools || 0) + 1; },
    currentToken: () => 'token',
    validToken: token => token === 'token',
    createId: prefix => `${prefix}-1`,
    rebuildWarp,
    getCurrentWarpQuad: item => item.mapQuad.map(point => [...point]),
    history,
    persist: () => { calls.persists += 1; return Promise.resolve(true); },
    renderEditor: () => { calls.editorRenders += 1; },
    refreshUi: () => { calls.refreshes += 1; },
    setHint: (text, tone) => { calls.hints.push({ text, tone }); },
  });
  return { interaction, record, records, mapElement, renderer, host, calls };
}

test('interaction controller owns mutually exclusive editing modes', () => {
  const { interaction, record, mapElement } = createHarness();

  assert.equal(interaction.startPlacementEditing(record), true);
  assert.equal(interaction.getState().placementEditingId, record.id);
  assert.equal(mapElement.classList.contains('is-reference-placement-mode'), true);

  assert.equal(interaction.startFreeTransformEditing(record), true);
  assert.equal(interaction.getState().placementEditingId, '');
  assert.equal(interaction.getState().freeTransformEditingId, record.id);
  assert.equal(mapElement.classList.contains('is-reference-placement-mode'), false);
  assert.equal(mapElement.classList.contains('is-reference-free-transform-mode'), true);

  assert.equal(interaction.armAnchor(record), true);
  assert.equal(interaction.getState().freeTransformEditingId, '');
  assert.equal(interaction.getState().anchorState.step, 'image');
  assert.equal(mapElement.classList.contains('is-reference-anchor-mode'), true);

  interaction.cancelAll();
  assert.equal(interaction.isActive(), false);
  assert.equal(mapElement.classList.contains('is-reference-anchor-mode'), false);
  assert.equal(mapElement.classList.contains('is-reference-free-transform-mode'), false);
});

test('GCP tap workflow is contained inside interaction controller', () => {
  const { interaction, record, calls } = createHarness();
  assert.equal(interaction.armGcp(record), true);

  const down = { button: 0, pointerId: 1 };
  const first = interaction.beginGesture([150, 150], down);
  assert.equal(first.kind, 'tap');
  first.end([150, 150]);
  assert.equal(interaction.getState().gcpState.step, 'map');
  assert.deepEqual(interaction.getState().gcpState.image, [0.25, 0.5]);

  const second = interaction.beginGesture([200, 100], down);
  second.end([200, 100]);

  assert.equal(record.controlPoints.length, 1);
  assert.deepEqual(record.controlPoints[0], {
    id: 'gcp-1',
    image: [0.25, 0.5],
    coordinate: [10, 10],
  });
  assert.equal(calls.history, 1);
  assert.equal(calls.persists, 1);
  assert.equal(interaction.getState().gcpState.step, 'image');
});

test('free transform drag history and corner-pin activation stay inside interaction controller', () => {
  const { interaction, record, host, calls } = createHarness();
  assert.equal(interaction.startFreeTransformEditing(record), true);

  const corner = host.project(record.mapQuad[1]);
  const down = { button: 0, pointerId: 3 };
  const gesture = interaction.beginGesture(corner, down);
  assert.equal(gesture.kind, 'exclusive');

  const moved = [corner[0] + 30, corner[1] - 20];
  assert.equal(gesture.move(moved, { ...down, shiftKey: false }), true);
  assert.equal(record.cornerPinEnabled, true);
  assert.notDeepEqual(record.mapQuad[1], [20, 10]);

  gesture.end(moved, down);
  assert.equal(calls.history, 1);
  assert.equal(calls.persists, 1);
});

test('locking a record exits every interaction mode for that record', () => {
  const { interaction, record } = createHarness();
  interaction.startFreeTransformEditing(record);
  record.locked = true;
  interaction.handleRecordLocked(record);
  assert.equal(interaction.isActive(), false);
  assert.equal(interaction.getState().freeTransformEditingId, '');
});
