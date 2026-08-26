import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDraftEditState,
  deleteDraftVertex,
  insertDraftVertex,
  moveDraftVertex,
  recordDraftSnapshot,
  redoDraftSnapshot,
  removeLastDraftVertex,
  undoDraftSnapshot,
} from '../../assets/js/modules/draft-editor.js';

test('draft vertices can be moved, inserted, deleted, and removed from the tail', () => {
  const original = [[0, 0], [10, 0], [10, 10]];
  assert.deepEqual(moveDraftVertex(original, 1, [8, 2]), [[0, 0], [8, 2], [10, 10]]);

  const inserted = insertDraftVertex(original, 0, [5, 0], false);
  assert.equal(inserted.insertedIndex, 1);
  assert.deepEqual(inserted.coords, [[0, 0], [5, 0], [10, 0], [10, 10]]);

  const deleted = deleteDraftVertex(inserted.coords, 1);
  assert.deepEqual(deleted.coords, original);
  assert.equal(deleted.selectedVertexIndex, 0);

  const shortened = removeLastDraftVertex(original, 2);
  assert.deepEqual(shortened.coords, [[0, 0], [10, 0]]);
  assert.equal(shortened.selectedVertexIndex, 1);
});

test('polygon closing segment inserts after the last vertex', () => {
  const triangle = [[0, 0], [10, 0], [5, 10]];
  const inserted = insertDraftVertex(triangle, 2, [2, 5], true);
  assert.equal(inserted.insertedIndex, 3);
  assert.deepEqual(inserted.coords, [[0, 0], [10, 0], [5, 10], [2, 5]]);
});

test('draft undo and redo stay local and a new mutation clears redo', () => {
  const editState = createDraftEditState();
  let coords = [];
  recordDraftSnapshot(editState, coords);
  coords = [[0, 0]];
  editState.selectedVertexIndex = 0;
  recordDraftSnapshot(editState, coords);
  coords = [[0, 0], [10, 0]];
  editState.selectedVertexIndex = 1;

  let snapshot = undoDraftSnapshot(editState, coords);
  coords = snapshot.coords;
  assert.deepEqual(coords, [[0, 0]]);
  assert.equal(snapshot.selectedVertexIndex, 0);

  snapshot = redoDraftSnapshot(editState, coords);
  coords = snapshot.coords;
  assert.deepEqual(coords, [[0, 0], [10, 0]]);
  assert.equal(snapshot.selectedVertexIndex, 1);

  snapshot = undoDraftSnapshot(editState, coords);
  coords = snapshot.coords;
  recordDraftSnapshot(editState, coords);
  assert.equal(editState.future.length, 0);
});
