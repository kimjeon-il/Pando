// The rendering domain owns displayed-Canvas admission tickets.
// Canvas Worker transport separately owns its in-flight bitmap requests.
export function createCanvasVisualFrameQueue() {
  const pending = new Map();
  const frameId = value => Number(value?.frameId || 0);
  function has(frame) { return pending.has(frameId(frame)); }
  function stage(frame) {
    pending.set(frameId(frame), frame);
    for (const [id, candidate] of pending) {
      if (candidate.projectGeneration !== frame.projectGeneration
        || candidate.viewRevision !== frame.viewRevision
        || candidate.projectionRevision !== frame.projectionRevision) pending.delete(id);
    }
  }
  function matchingFrame(result) {
    const frame = pending.get(frameId(result));
    if (!frame
      || Number(result?.viewRevision || 0) !== Number(frame.viewRevision || 0)
      || Number(result?.projectionRevision || 0) !== Number(frame.projectionRevision || 0)
      || Number(result?.projectGeneration || 0) !== Number(frame.projectGeneration || 0)) return null;
    return frame;
  }
  function retire(frame, { canvasPresented = false } = {}) {
    const committed = frameId(frame);
    if (canvasPresented) {
      for (const id of pending.keys()) if (id <= committed) pending.delete(id);
    } else pending.delete(committed);
  }
  return Object.freeze({ has, stage, matchingFrame, retire, clear: () => pending.clear() });
}
