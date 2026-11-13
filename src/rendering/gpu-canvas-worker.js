// Canvas transport owns readiness, latest-frame backpressure, stale delivery and
// outstanding picks. The coordinator serializes scene state and presents accepted frames.
export function createGpuCanvasWorker({ worker, generation, acceptFrame, allowOlderBackgroundFrame = () => false, onStale = () => {}, onSend = () => {} }) {
  let live = true, ready = false, pendingFrame = null, latestFrame = null;
  let inFlightRenderRequestId = null, renderRequestId = 0;
  let requestedRevision = 0, displayedRevision = 0, requestId = 0;
  let onmessage = null, onerror = null;
  const picks = new Map();
  function postMessage(...args) {
    if (!live) return false;
    try {
      // MessageChannel hand-off was never included in scene message counters.
      if (args[0]?.type !== 'hydro-port') onSend(args[0]);
      worker.postMessage(...args);
      return true;
    } catch (error) {
      // A failed synchronous send is a transport failure, not a completed
      // Canvas submission. Route it to the existing renderer fallback owner.
      onerror?.({error,message:error?.message||String(error),preventDefault(){}});
      return false;
    }
  }
  function flush() {
    if (!live || !ready || inFlightRenderRequestId !== null || !pendingFrame) return;
    const message = pendingFrame; pendingFrame = null;
    inFlightRenderRequestId = ++renderRequestId;
    if (!postMessage({ ...message, renderRequestId: inFlightRenderRequestId })) {
      inFlightRenderRequestId = null;
      if (live && !pendingFrame) pendingFrame = latestFrame || message;
    }
  }
  function settlePick(id, value, error = null) {
    const pending = picks.get(id);
    if (!pending) return;
    picks.delete(id); clearTimeout(pending.timer);
    if (error) pending.reject(Object.assign(new Error(error.message), { code: error.code, stack: error.stack }));
    else pending.resolve(value);
  }
  worker.onmessage = event => {
    const message = event.data || {};
    if (!live) { message.bitmap?.close?.(); return; }
    if (message.type === 'ready') {
      ready = true;
      onmessage?.(event);
      flush();
      return;
    }
    if (message.type === 'hydro-pick') { settlePick(Number(message.requestId), message.fid, message.error); return; }
    if (message.type !== 'frame') { onmessage?.(event); return; }
    // Completion belongs to a submission, independently of bitmap freshness.
    const acknowledged = inFlightRenderRequestId !== null && message.renderRequestId === inFlightRenderRequestId
      && Number(message.projectGeneration) === generation;
    if (acknowledged) {
      inFlightRenderRequestId = null;
      // Style, physical-packet and boundary messages can cancel an expensive
      // Canvas paint. The Worker acknowledges without a bitmap; there is no
      // pending view left in the transport because flush consumed it. Replay
      // the latest exact visual request after those messages are applied.
      if (!message.bitmap && !pendingFrame && latestFrame
        && Number(latestFrame.projectGeneration) === generation) pendingFrame = latestFrame;
    }
    const revision = Number(message.revision || 0);
    // The latest *picture*, not the latest unrelated coordinator revision,
    // controls initial physical layer frames. The opt-in must independently
    // validate camera, style, pin and source before accepting older revisions.
    const current = !!message.bitmap
      && Number(message.projectGeneration ?? generation) === generation
      && revision >= displayedRevision
      && (revision >= requestedRevision || allowOlderBackgroundFrame(message))
      && acceptFrame(message);
    if (current && message.bitmap) {
      displayedRevision = revision;
      onmessage?.(event);
    } else {
      if (message.bitmap) onStale(message);
      message.bitmap?.close?.();
    }
    flush();
  };
  worker.onerror = event => { event.preventDefault?.(); if (live) onerror?.(event); };
  return Object.freeze({
    get onmessage() { return onmessage; }, set onmessage(handler) { onmessage = handler; },
    get onerror() { return onerror; }, set onerror(handler) { onerror = handler; },
    get ready() { return ready; }, get busy() { return inFlightRenderRequestId !== null; }, get hasPendingFrame() { return !!pendingFrame; },
    postMessage,
    resetGeneration(next) {
      generation = Number(next);
      pendingFrame = null; latestFrame = null; inFlightRenderRequestId = null;
      requestedRevision = 0; displayedRevision = 0;
      for (const id of picks.keys()) settlePick(id, null);
      // Reset the actual Worker before any new-generation state or view is sent.
      postMessage({ type: 'reset-generation', projectGeneration: generation });
    },
    queueFrame(message) {
      if (!live || Number(message.projectGeneration) !== generation) return;
      const revision = Number(message.revision || 0);
      if (revision >= requestedRevision) latestFrame = message;
      requestedRevision = Math.max(requestedRevision, revision);
      if (!pendingFrame || Number(pendingFrame.revision || 0) <= revision) pendingFrame = message;
      flush();
    },
    pick(point) {
      if (!live || !ready) return Promise.resolve(null);
      const id = ++requestId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => settlePick(id, null), 900);
        picks.set(id, { resolve, reject, timer });
        if (!postMessage({ type: 'hydro-pick', requestId: id, point }))
          settlePick(id, null, {message:'Canvas Worker request was not delivered',code:'PL-CANVAS-WORKER-SEND'});
      });
    },
    terminate() {
      if (!live) return;
      live = false; ready = false; inFlightRenderRequestId = null; pendingFrame = null; latestFrame = null;
      for (const id of picks.keys()) settlePick(id, null);
      worker.terminate(); onmessage = null; onerror = null;
    },
  });
}
// @worker-transport dedicated: Canvas rendering owns frame dispatch and persistent picking requests
