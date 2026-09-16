// One owner for worker identity, lifetime and delivery. Payloads and transfer lists
// pass through unchanged; domain-specific revision checks remain with consumers.
export function createGpuWorkerChannels({ WorkerClass = globalThis.Worker } = {}) {
  const channels = new Set();
  let disposed = false;
  function create(url, options) {
    if (disposed) throw Object.assign(new Error('Renderer disposed'), { name: 'AbortError' });
    const worker = new WorkerClass(url, options);
    let live = true;
    let onmessage = null;
    let onerror = null;
    const channel = {
      get onmessage() { return onmessage; },
      set onmessage(handler) { onmessage = handler; },
      get onerror() { return onerror; },
      set onerror(handler) { onerror = handler; },
      postMessage(...args) { if (live && !disposed) worker.postMessage(...args); },
      terminate() {
        if (!live) return;
        live = false;
        channels.delete(channel);
        worker.terminate();
        onmessage = null; onerror = null;
      },
    };
    worker.onmessage = event => {
      if (!live || disposed) { event.data?.bitmap?.close?.(); return; }
      onmessage?.(event);
    };
    worker.onerror = event => { if (live && !disposed) onerror?.(event); };
    channels.add(channel);
    return channel;
  }
  return Object.freeze({
    create,
    WorkerClass: function OwnedWorker(url, options) { return create(url, options); },
    dispose() { if (disposed) return; disposed = true; for (const channel of channels) channel.terminate(); },
  });
}
