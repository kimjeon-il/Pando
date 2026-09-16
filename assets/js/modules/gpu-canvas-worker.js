// Canvas transport owns readiness, latest-frame backpressure, stale delivery and
// outstanding picks. The coordinator serializes scene state and presents accepted frames.
export function createGpuCanvasWorker({ worker, generation, acceptFrame, onStale = () => {}, onSend = () => {} }) {
  let live = true, ready = false, busy = false, pendingFrame = null;
  let requestedRevision = 0, displayedRevision = 0, requestId = 0;
  let onmessage = null, onerror = null;
  const picks = new Map();
  function postMessage(...args) {
    if (!live) return false;
    // MessageChannel hand-off was never included in scene message counters.
    if (args[0]?.type !== 'hydro-port') onSend(args[0]);
    worker.postMessage(...args); return true;
  }
  function flush() {
    if (!live || !ready || busy || !pendingFrame) return;
    const message = pendingFrame; pendingFrame = null;
    busy = true; postMessage(message);
  }
  function settlePick(id, value) {
    const pending = picks.get(id);
    if (!pending) return;
    picks.delete(id); clearTimeout(pending.timer); pending.resolve(value);
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
    if (message.type === 'hydro-pick') { settlePick(Number(message.requestId), message.fid); return; }
    if (message.type !== 'frame') { onmessage?.(event); return; }
    busy = false;
    const revision = Number(message.revision || 0);
    const current = Number(message.projectGeneration ?? generation) === generation
      && revision >= requestedRevision && revision >= displayedRevision && acceptFrame(message);
    if (current && message.bitmap) {
      displayedRevision = revision;
      onmessage?.(event);
    } else {
      if (message.bitmap) onStale(message);
      message.bitmap?.close?.();
    }
    flush();
  };
  worker.onerror = event => { if (live) onerror?.(event); };
  return Object.freeze({
    get onmessage() { return onmessage; }, set onmessage(handler) { onmessage = handler; },
    get onerror() { return onerror; }, set onerror(handler) { onerror = handler; },
    get ready() { return ready; }, get busy() { return busy; }, get hasPendingFrame() { return !!pendingFrame; },
    postMessage,
    queueFrame(message) {
      if (!live) return;
      requestedRevision = Math.max(requestedRevision, Number(message.revision || 0));
      if (!pendingFrame || Number(pendingFrame.revision || 0) <= Number(message.revision || 0)) pendingFrame = message;
      flush();
    },
    pick(point) {
      if (!live || !ready) return Promise.resolve(null);
      const id = ++requestId;
      return new Promise(resolve => {
        const timer = setTimeout(() => settlePick(id, null), 900);
        picks.set(id, { resolve, timer });
        postMessage({ type: 'hydro-pick', requestId: id, point });
      });
    },
    terminate() {
      if (!live) return;
      live = false; ready = false; busy = false; pendingFrame = null;
      for (const id of picks.keys()) settlePick(id, null);
      worker.terminate(); onmessage = null; onerror = null;
    },
  });
}
