export function createEditingDomain({
  context = null,
  projectDomain = null,
  gisDomain = null,
  selectionDomain = null,
  renderingDomain = null,
  draftEditor = null,
  previewController = null,
  snapController = null,
  transactionRunner = null,
  toolController = null,
  renderPackets = null,
  onEditingStateChanged = () => {},
} = {}) {
  let phase = 'idle';
  let activeTool = null;
  let disposed = false;
  const tool = toolController || {};
  const draft = renderPackets?.draft || {};
  const imports = renderPackets?.imports || {};
  const emit = reason => {
    const value = Object.freeze({ phase, activeTool, reason: String(reason || '') });
    onEditingStateChanged(value);
    context?.publish?.('editing-state-changed', value);
    return value;
  };
  const active = () => { if (disposed) throw new Error('Editing domain is disposed.'); };
  const beginTool = tool => { active(); activeTool = tool || null; phase = 'active'; return emit('begin-tool'); };
  const setTool = (nextTool, options = {}) => {
    active();
    const name = String(nextTool || 'select');
    if (name !== 'select' && tool.requireCanonicalData && !tool.requireCanonicalData()) return false;
    if (tool.getGeometryPreviewSession?.() && tool.getCurrentTool?.() !== name) {
      tool.discardGeometryPreview?.({ announce: false });
    }
    if (tool.getCurrentTool?.() !== name) tool.clearDraftInput?.(true);
    tool.clearActiveSnap?.();
    tool.clearHover?.();
    tool.resetForTool?.(name);
    tool.setCurrentToolState?.(name);
    activeTool = name;
    phase = name === 'select' ? 'idle' : 'active';
    tool.applyToolPresentation?.(name, options);
    return emit('tool-change');
  };
  const draftInputActive = () => !!draft.isActive?.();
  const commitDraftCoords = (nextCoords, selectedVertexIndex = draft.getEdit?.()?.selectedVertexIndex, options = {}) => {
    active();
    if (!draftInputActive()) return false;
    const edit = draft.getEdit?.() || {};
    if (options.record !== false) draft.recordSnapshot?.(edit, draft.getCoords?.() || [], edit.selectedVertexIndex);
    draft.setCoords?.((nextCoords || []).map(coord => coord.slice()));
    if (options.inputPhase) draft.setInputPhase?.(options.inputPhase);
    draft.setSelectedVertex?.(Number.isInteger(selectedVertexIndex) && selectedVertexIndex >= 0 && selectedVertexIndex < (draft.getCoords?.() || []).length ? selectedVertexIndex : null);
    draft.syncAfterMutation?.({ buildPreview: options.buildPreview !== false });
    return true;
  };
  const appendDraftCoordinate = (coord, options = {}) => {
    if (!draftInputActive() || !Array.isArray(coord)) return false;
    const coords = draft.getCoords?.() || [];
    if (options.dedupe && coords.length && draft.coordNear?.(coords.at(-1), coord, 1e-9)) return false;
    return commitDraftCoords([...coords.map(item => item.slice()), coord.slice()], coords.length, { inputPhase: 'draw' });
  };
  const performDraftUndo = () => {
    if (!draftInputActive() || draft.isStrokeActive?.()) return false;
    const edit = draft.getEdit?.() || {};
    const snapshot = draft.undoSnapshot?.(edit, draft.getCoords?.() || []);
    if (!snapshot) return false;
    draft.setCoords?.(snapshot.coords);
    draft.setSelectedVertex?.(snapshot.selectedVertexIndex);
    draft.syncAfterMutation?.({ buildPreview: true });
    return true;
  };
  const performDraftRedo = () => {
    if (!draftInputActive() || draft.isStrokeActive?.()) return false;
    const edit = draft.getEdit?.() || {};
    const snapshot = draft.redoSnapshot?.(edit, draft.getCoords?.() || []);
    if (!snapshot) return false;
    draft.setCoords?.(snapshot.coords);
    draft.setSelectedVertex?.(snapshot.selectedVertexIndex);
    draft.syncAfterMutation?.({ buildPreview: true });
    return true;
  };
  const removeLastDraftPoint = () => {
    if (!draftInputActive() || draft.isStrokeActive?.()) return false;
    const coords = draft.getCoords?.() || [];
    if (!coords.length) return false;
    const result = draft.removeLastVertex?.(coords, draft.getEdit?.()?.selectedVertexIndex);
    return result ? commitDraftCoords(result.coords, result.selectedVertexIndex) : false;
  };
  const deleteSelectedDraftPoint = () => {
    if (!draftInputActive() || draft.isStrokeActive?.()) return false;
    const index = draft.getEdit?.()?.selectedVertexIndex;
    if (!Number.isInteger(index)) return false;
    const result = draft.deleteVertex?.(draft.getCoords?.() || [], index);
    return result ? commitDraftCoords(result.coords, result.selectedVertexIndex, { inputPhase: 'refine' }) : false;
  };
  const insertDraftPoint = () => {
    if (!draftInputActive() || draft.isStrokeActive?.()) return false;
    const target = draft.getInsertTarget?.();
    if (!target?.coordinate || !Number.isInteger(target.segmentIndex)) return false;
    const result = draft.insertVertex?.(draft.getCoords?.() || [], target.segmentIndex, target.coordinate, !!draft.isPolygon?.());
    return result?.insertedIndex != null ? commitDraftCoords(result.coords, result.insertedIndex, { inputPhase: 'refine' }) : false;
  };
  const moveSelectedDraftPointByPixels = (dx, dy) => {
    if (!draftInputActive() || draft.isStrokeActive?.()) return false;
    const index = draft.getEdit?.()?.selectedVertexIndex;
    const coords = draft.getCoords?.() || [];
    if (!Number.isInteger(index) || !coords[index]) return false;
    const projected = draft.projectCoordinate?.(coords[index]);
    const coordinate = projected ? draft.unprojectScreen?.([projected[0] + dx, projected[1] + dy]) : null;
    if (!coordinate) return false;
    const moved = draft.moveVertex?.(coords, index, coordinate);
    return moved ? commitDraftCoords(moved, index, { inputPhase: 'refine' }) : false;
  };
  const importProject = (...args) => imports.replaceProject?.(...args);
  const mergeCountries = (...args) => imports.mergeCountries?.(...args);
  const importTerritorial = (...args) => imports.territorial?.(...args);
  const importGeneric = (...args) => imports.geoJson?.(...args);
  const importDistribution = (...args) => imports.distribution?.(...args);
  const commitImport = (...args) => imports.commitImport?.(...args);
  const reconcileCoast = (...args) => imports.reconcileCoast?.(...args);
  const updatePointer = input => { active(); if (phase === 'idle') return emit('pointer-ignored'); draftEditor?.updatePointer?.(input); previewController?.update?.(input); renderPackets?.update?.(input); return emit('pointer-update'); };
  const finishTool = () => { active(); draftEditor?.finish?.(); phase = 'idle'; activeTool = null; return emit('finish-tool'); };
  const cancelTool = reason => { active(); draftEditor?.cancel?.(reason); previewController?.clear?.(); phase = 'idle'; activeTool = null; return emit(reason || 'cancel-tool'); };
  const beginBoundaryEdit = target => { active(); phase = 'boundary-edit'; activeTool = target || null; return emit('begin-boundary-edit'); };
  const applyGeometryPatch = async (domain, patch) => { active(); if (typeof transactionRunner === 'function') return transactionRunner({ domain, patch, projectGeneration: projectDomain?.getGeneration?.() || 0 }); return projectDomain?.dispatch?.({ type: `${domain}-geometry-patch`, patch }); };
  const executeTerritorialTransaction = plan => applyGeometryPatch('territorial', plan);
  const commit = () => { active(); phase = 'idle'; activeTool = null; renderingDomain?.invalidate?.(0, 'editing-commit'); return emit('commit'); };
  const cancel = reason => cancelTool(reason || 'cancel');
  const dispose = () => { disposed = true; phase = 'idle'; activeTool = null; };
  return Object.freeze({ setTool, beginTool, updatePointer, finishTool, cancelTool, beginBoundaryEdit, applyGeometryPatch, executeTerritorialTransaction, commit, cancel, dispose, draftInputActive, commitDraftCoords, appendDraftCoordinate, performDraftUndo, performDraftRedo, removeLastDraftPoint, deleteSelectedDraftPoint, insertDraftPoint, moveSelectedDraftPointByPixels, importProject, mergeCountries, importTerritorial, importGeneric, importDistribution, commitImport, reconcileCoast, snapshot: () => Object.freeze({ phase, activeTool, projectGeneration: projectDomain?.getGeneration?.() || 0, hasGisDomain: !!gisDomain, hasSelectionDomain: !!selectionDomain, hasSnapController: !!snapController }) });
}
