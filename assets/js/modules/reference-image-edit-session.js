export function copyReferenceImageRecords(records) {
  return records.map(record => ({
    ...record,
    screenRect: record.screenRect ? { ...record.screenRect } : null,
    controlPoints: record.controlPoints.map(point => ({ ...point, image: [...point.image], coordinate: [...point.coordinate] })),
    projectedMesh: null,
  }));
}

export function applyReferenceImageEdit(record, action, { id, value } = {}) {
  if (!record || record.locked) return false;
  if (action === 'flip-x' || action === 'flip-y') {
    if (record.controlPoints.length) return false;
    const key = action === 'flip-x' ? 'flipX' : 'flipY';
    record[key] = !record[key];
    return true;
  }
  if (action === 'clear-gcp') {
    if (!record.controlPoints.length) return false;
    record.controlPoints = []; return true;
  }
  const index = record.controlPoints.findIndex(point => point.id === id);
  if (index < 0) return false;
  if (action === 'delete-gcp') { record.controlPoints.splice(index, 1); return true; }
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) return false;
  if (action === 'replace-image' && value.every(component => component >= 0 && component <= 1)) {
    record.controlPoints[index].image = [...value]; return true;
  }
  if (action === 'replace-coordinate' && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90) {
    record.controlPoints[index].coordinate = [...value]; return true;
  }
  return false;
}

// Bounded in-memory snapshots retain decoded images/Blobs, not copies of pixels.
export function createReferenceImageHistory() {
  const undo = [], redo = [];
  return {
    push(before) { undo.push(copyReferenceImageRecords(before)); if (undo.length > 50) undo.shift(); redo.length = 0; },
    undo(current) { if (!undo.length) return null; redo.push(copyReferenceImageRecords(current)); return copyReferenceImageRecords(undo.pop()); },
    redo(current) { if (!redo.length) return null; undo.push(copyReferenceImageRecords(current)); return copyReferenceImageRecords(redo.pop()); },
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    clear() { undo.length = 0; redo.length = 0; },
  };
}
