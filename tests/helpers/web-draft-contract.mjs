import { loadWebOracle } from './web-oracle.mjs';
const { createEditingDomain } = await loadWebOracle('assets/js/modules/editing-domain.js');

/** Tiny actual Web draft/gesture fixture with an explicitly controlled frame port. */
export async function captureWebDraftContract() {
  const frames = new Map(); let frameId = 0;
  const editing = createEditingDomain({ draftServices: {
    getToolConfig: tool => tool === 'polygon' ? { shape: 'polygon' } : null,
    projectCoordinate: coordinate => coordinate, screenToCoordinate: coordinate => coordinate,
    requestFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelFrame: id => frames.delete(id),
  }, projectDomain: { getGeneration: () => 1, undo() { throw new Error('Draft history must remain detached from project history.'); } } });
  const event = (type, detail = {}) => ({ type, projectGeneration: 1, packetRevision: editing.snapshot().revision, ...detail });
  const rows = [];
  const capture = async (operation, action) => {
    const result = await action();
    rows.push({ operation, result: result === undefined ? null : result, snapshot: structuredClone(editing.snapshot()) });
  };
  await capture('activate the polygon tool before starting a draft', () => editing.setTool('polygon'));
  await capture('start polygon in draw phase', () => editing.startDraft({ coords: [[0,0],[12,0],[12,8]] }));
  await capture('unmoved drag checkpoints the selected vertex before refining', () => editing.handleInteraction(event('draft-vertex-drag-start', { gestureId: 'still', vertexIndex: 1 })));
  await capture('unmoved drag end retains its draft checkpoint', () => editing.handleInteraction(event('draft-vertex-drag-end', { gestureId: 'still' })));
  await capture('Undo restores selected vertex and draw phase for unchanged coordinates', () => editing.performDraftUndo());
  await capture('Redo restores selected vertex and refine phase', () => editing.performDraftRedo());
  await capture('moved drag starts one checkpoint', () => editing.handleInteraction(event('draft-vertex-drag-start', { gestureId: 'moved', vertexIndex: 2 })));
  await capture('first move is queued without changing coordinates', () => editing.handleInteraction(event('draft-vertex-drag-move', { gestureId: 'moved', screenPoint: [14.125,9.25] })));
  await capture('latest queued move replaces the earlier move', () => editing.handleInteraction(event('draft-vertex-drag-move', { gestureId: 'moved', screenPoint: [15.125,10.25] })));
  await capture('drag end flushes the latest pending move before completion', () => editing.handleInteraction(event('draft-vertex-drag-end', { gestureId: 'moved' })));
  frames.clear();
  await capture('Undo moved drag restores exact original coordinates and vertex', () => editing.performDraftUndo());
  await capture('insert mode activates without document history', () => editing.setDraftVertexInsertMode(true));
  await capture('closing polygon segment hover owns an insertion target', () => editing.handleInteraction(event('draft-segment-hover', { segmentIndex: 2, screenPoint: [6,4] })));
  await capture('insert target creates an exact new vertex and clears redo', () => editing.handleInteraction(event('draft-insert-request')));
  await capture('delete selected vertex retains preceding selection and refine phase', () => editing.deleteSelectedDraftPoint());
  await capture('Undo deletion restores inserted vertex and selected index', () => editing.performDraftUndo());
  await capture('Redo deletion restores preceding selection', () => editing.performDraftRedo());
  await capture('invalid vertex select is a no-op', () => editing.handleInteraction(event('draft-vertex-select', { vertexIndex: 999 })));
  await capture('cancelled gesture clears dragging and retains the draft checkpoint', () => {
    editing.handleInteraction(event('draft-vertex-drag-start', { gestureId: 'cancel', vertexIndex: 1 }));
    return editing.cancelActiveGesture('fixture-user-cancel');
  });
  await capture('draft clear resets local edit state', () => editing.clearDraft());
  await capture('empty draft Undo is a no-op', () => editing.performDraftUndo());
  await capture('bounded history keeps the most recent100 entries', () => {
    for (let i=0;i<101;i++) editing.replaceDraftCoordinates([[i+0.125,0],[i+1.25,1],[i+2.5,3]], { record: true, selectedVertexIndex: 1, inputPhase: 'refine' });
    return editing.snapshot().draft.historyCount;
  });
  await capture('Undo bounded history retains exact precision and selected vertex', () => editing.performDraftUndo());
  editing.dispose();
  return rows;
}
