let scopeSequence = 0;

// The domain owns the scheduler. Each renderer can cancel only its own jobs,
// including jobs submitted by its polygon, stroke and terrain owners.
export function createGpuUploadScope(scheduler) {
  const prefix = `renderer:${++scopeSequence}:`;
  const jobs = new Map();
  function cancelKey(key) {
    if (!jobs.has(key)) return;
    jobs.delete(key);
    scheduler.cancelKey(prefix + key);
  }
  return Object.freeze({
    enqueueUpload(input) {
      if (jobs.has(input.key)) return jobs.get(input.key);
      const promise = scheduler.enqueueUpload({ ...input, key: prefix + input.key });
      jobs.set(input.key, promise);
      const complete = () => { if (jobs.get(input.key) === promise) jobs.delete(input.key); };
      void promise.then(complete, complete);
      return promise;
    },
    cancelKey,
    cancelAll() { for (const key of jobs.keys()) cancelKey(key); },
    defer() { scheduler.defer(); },
  });
}

// Owns only allocations made by the coordinator. Dedicated passes own their GL objects.
export function createGpuResourceLifecycle() {
  const resources = new Map();
  const listeners = new Set();
  const timers = new Set();
  const frames = new Set();
  const awaitedFrames = new Map();
  let disposed = false;
  let revision = 0;
  function retain(gl, kind, value) {
    if (value) resources.set(value, { gl, kind });
    return value;
  }
  function release(value) {
    const entry = resources.get(value);
    if (!entry) return;
    resources.delete(value);
    if (!entry.gl.isContextLost?.()) entry.gl[`delete${entry.kind}`](value);
  }
  function releaseContext(gl) {
    revision++;
    for (const [value, entry] of resources) if (!gl || entry.gl === gl) release(value);
  }
  return Object.freeze({
    retain,
    create(gl, kind) { return disposed ? null : retain(gl, kind, gl[`create${kind}`]()); },
    release,
    releaseContext,
    revision: () => revision,
    isDisposed: () => disposed,
    listen(target, type, listener) {
      if (disposed) return;
      target.addEventListener(type, listener);
      listeners.add({ target, type, listener });
    },
    unlisten(target) {
      for (const entry of listeners) if (entry.target === target) {
        entry.target.removeEventListener(entry.type, entry.listener);
        listeners.delete(entry);
      }
    },
    timeout(callback, delay) {
      if (disposed) return 0;
      const timer = setTimeout(() => { timers.delete(timer); if (!disposed) callback(); }, delay);
      timers.add(timer);
      return timer;
    },
    cancelTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
    frame(callback) {
      if (disposed) return 0;
      const frame = requestAnimationFrame(time => { frames.delete(frame); if (!disposed) callback(time); });
      frames.add(frame);
      return frame;
    },
    cancelFrame(frame) { cancelAnimationFrame(frame); frames.delete(frame); },
    nextFrame() {
      if (disposed) return Promise.reject(new DOMException('Renderer disposed', 'AbortError'));
      return new Promise((resolve, reject) => {
        const frame = requestAnimationFrame(time => {
          if (!awaitedFrames.delete(frame) || disposed) return;
          resolve(time);
        });
        awaitedFrames.set(frame, reject);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      for (const frame of frames) cancelAnimationFrame(frame);
      for (const [frame, reject] of awaitedFrames) {
        cancelAnimationFrame(frame);
        reject(new DOMException('Renderer disposed', 'AbortError'));
      }
      awaitedFrames.clear();
      timers.clear(); frames.clear();
      for (const entry of listeners) entry.target.removeEventListener(entry.type, entry.listener);
      listeners.clear();
      releaseContext();
    },
  });
}
