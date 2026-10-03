import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReferenceImageEdit, createReferenceImageHistory } from '../../assets/js/modules/reference-image-edit-session.js';

const record = () => ({
  id: 'a',
  locked: false,
  flipX: false,
  flipY: false,
  controlPoints: [{ id: 'p', image: [0.2, 0.3], coordinate: [12, 34] }],
  mapQuad: [[10, 20], [20, 20], [20, 10], [10, 10]],
});

test('reflection cannot discard existing control points even when invoked without a button', () => {
  const value = record();
  assert.equal(applyReferenceImageEdit(value, 'flip-x'), false);
  assert.equal(value.flipX, false);
  assert.equal(value.controlPoints.length, 1);
});

test('reflection is rejected while a placement anchor is active', () => {
  const value = {
    id: 'anchor',
    locked: false,
    flipX: false,
    flipY: false,
    controlPoints: [],
    anchor: { image: [0.25, 0.5], coordinate: [12, 34] },
    mapQuad: [[10, 20], [20, 20], [20, 10], [10, 10]],
  };
  assert.equal(applyReferenceImageEdit(value, 'flip-x'), false);
  assert.equal(value.flipX, false);
});

test('locked reference rejects all geometry and point mutations', () => {
  const value = record(); value.locked = true;
  const original = structuredClone(value);
  for (const action of ['clear-gcp', 'delete-gcp', 'replace-image', 'replace-coordinate', 'flip-x', 'flip-y']) {
    assert.equal(applyReferenceImageEdit(value, action, { id: 'p', value: [1, 2] }), false);
    assert.deepEqual(value, original);
  }
});

test('replacing one side of a control point preserves the other side and rejects invalid coordinates', () => {
  const value = record();
  assert.equal(applyReferenceImageEdit(value, 'replace-image', { id: 'p', value: [0.4, 0.8] }), true);
  assert.deepEqual(value.controlPoints[0], { id: 'p', image: [0.4, 0.8], coordinate: [12, 34] });
  assert.equal(applyReferenceImageEdit(value, 'replace-coordinate', { id: 'p', value: [NaN, 2] }), false);
  assert.deepEqual(value.controlPoints[0].coordinate, [12, 34]);
});

test('session undo and redo clone mapQuad and restore deleted images without serializing history', () => {
  const value = record(); const history = createReferenceImageHistory();
  history.push([value], []);
  value.controlPoints[0].coordinate[0] = 999;
  value.mapQuad[0][0] = 999;
  const restored = history.undo([]);
  assert.equal(restored[0].controlPoints[0].coordinate[0], 12);
  assert.equal(restored[0].mapQuad[0][0], 10);
  assert.deepEqual(history.redo(restored), []);
  history.clear();
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
});
