const cloneCoords = coords => (coords || []).map(coord => [Number(coord[0]), Number(coord[1])]);

export function createDraftEditState() {
  return {
    inputPhase: 'draw',
    selectedVertexIndex: null,
    insertTarget: null,
    history: [],
    future: [],
    issues: [],
    splitPreview: null,
    revision: 0,
    dragging: false,
  };
}

function snapshotDraft(coords, selectedVertexIndex = null, inputPhase = 'draw') {
  return {
    coords: cloneCoords(coords),
    selectedVertexIndex: Number.isInteger(selectedVertexIndex) ? selectedVertexIndex : null,
    inputPhase: inputPhase === 'refine' ? 'refine' : 'draw',
  };
}

export function resetDraftEditState(editState) {
  editState.inputPhase = 'draw';
  editState.selectedVertexIndex = null;
  editState.insertTarget = null;
  editState.history = [];
  editState.future = [];
  editState.issues = [];
  editState.splitPreview = null;
  editState.revision += 1;
  editState.dragging = false;
  return editState;
}

export function recordDraftSnapshot(editState, coords, selectedVertexIndex = editState.selectedVertexIndex, maxHistory = 100) {
  editState.history.push(snapshotDraft(coords, selectedVertexIndex, editState.inputPhase));
  if (editState.history.length > maxHistory) editState.history.shift();
  editState.future = [];
}

export function undoDraftSnapshot(editState, coords) {
  if (!editState.history.length) return null;
  editState.future.push(snapshotDraft(coords, editState.selectedVertexIndex, editState.inputPhase));
  const snapshot = editState.history.pop();
  editState.selectedVertexIndex = snapshot.selectedVertexIndex;
  editState.inputPhase = snapshot.inputPhase;
  editState.insertTarget = null;
  editState.revision += 1;
  return snapshotDraft(snapshot.coords, snapshot.selectedVertexIndex, snapshot.inputPhase);
}

export function redoDraftSnapshot(editState, coords) {
  if (!editState.future.length) return null;
  editState.history.push(snapshotDraft(coords, editState.selectedVertexIndex, editState.inputPhase));
  const snapshot = editState.future.pop();
  editState.selectedVertexIndex = snapshot.selectedVertexIndex;
  editState.inputPhase = snapshot.inputPhase;
  editState.insertTarget = null;
  editState.revision += 1;
  return snapshotDraft(snapshot.coords, snapshot.selectedVertexIndex, snapshot.inputPhase);
}

export function moveDraftVertex(coords, vertexIndex, coordinate) {
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= (coords?.length || 0)) return cloneCoords(coords);
  const next = cloneCoords(coords);
  next[vertexIndex] = [Number(coordinate[0]), Number(coordinate[1])];
  return next;
}

export function insertDraftVertex(coords, segmentIndex, coordinate, polygon = false) {
  const next = cloneCoords(coords);
  const count = next.length;
  const segmentCount = polygon && count >= 3 ? count : Math.max(0, count - 1);
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= segmentCount) {
    return { coords: next, insertedIndex: null };
  }
  const insertedIndex = polygon && segmentIndex === count - 1 ? count : segmentIndex + 1;
  next.splice(insertedIndex, 0, [Number(coordinate[0]), Number(coordinate[1])]);
  return { coords: next, insertedIndex };
}

export function deleteDraftVertex(coords, vertexIndex) {
  const next = cloneCoords(coords);
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= next.length) {
    return { coords: next, selectedVertexIndex: null };
  }
  next.splice(vertexIndex, 1);
  const selectedVertexIndex = next.length ? Math.min(Math.max(0, vertexIndex - 1), next.length - 1) : null;
  return { coords: next, selectedVertexIndex };
}

export function removeLastDraftVertex(coords, selectedVertexIndex = null) {
  const next = cloneCoords(coords);
  if (!next.length) return { coords: next, selectedVertexIndex: null };
  next.pop();
  const nextSelection = Number.isInteger(selectedVertexIndex) && selectedVertexIndex < next.length
    ? selectedVertexIndex
    : next.length ? next.length - 1 : null;
  return { coords: next, selectedVertexIndex: nextSelection };
}
