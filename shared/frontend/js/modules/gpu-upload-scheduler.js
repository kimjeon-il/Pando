// One upload frame budget shared by every GPU consumer. Steps must be synchronous.
export function createGpuUploadScheduler({ requestFrame = callback => globalThis.requestAnimationFrame?.(callback) ?? globalThis.setTimeout(callback, 16), cancelFrame = id => globalThis.cancelAnimationFrame?.(id), now = () => performance.now(), isHidden = () => globalThis.document?.hidden, isInputPending = () => globalThis.navigator?.scheduling?.isInputPending?.(), getByteBudget = () => 2 * 1024 * 1024 } = {}) {
  const jobs = new Map();
  // Priorities are immutable per job. Keep order on admission instead of
  // resorting every rendered frame; incomplete equal-priority jobs rotate.
  const orderedJobs = [];
  const insertOrdered = job => {
    const before=orderedJobs.findIndex(current=>current.priority<job.priority);
    if(before<0)orderedJobs.push(job);else orderedJobs.splice(before,0,job);
  };
  const removeOrdered = job => {
    const index=orderedJobs.indexOf(job);
    if(index>=0)orderedJobs.splice(index,1);
  };
  let frame = 0, active = false, lastInput = -Infinity, disposed = false;
  const stats = { frames: 0, uploadedBytes: 0, maxFrameMs: 0, overrunCount: 0, completed: 0, cancelled: 0 };
  const schedule = () => { if (!disposed && jobs.size && !frame) frame = requestFrame(drain); };
  function drain() {
    frame = 0;
    if (disposed) return;
    if (isHidden()) { schedule(); return; }
    // Input-pending should pause optional GPU uploads, not starve explicitly
    // admitted current-view terrain resources during a held drag or wheel.
    // The existing per-frame time/byte budgets still constrain these jobs.
    const pendingInput = isInputPending();
    if (pendingInput) lastInput = now();
    const interaction = active || pendingInput || now() - lastInput < 500;
    const start = now();
    let bytes = Math.min(interaction ? 256 * 1024 : 2 * 1024 * 1024, Math.max(4, getByteBudget()));
    // Snapshot admission order to avoid processing a rotated entry twice.
    for (const job of [...orderedJobs]) {
      if (now() - start >= 2 || bytes <= 0) break;
      if (!jobs.has(job.key)) continue;
      // Visible resources must progress during navigation. Background work
      // keeps its quiet period; both paths share the same frame/time budget.
      if (interaction && !job.allowDuringInteraction) continue;
      try {
        const result = job.step({ byteBudget: Math.min(bytes, 256 * 1024), deadline: start + 2 }) || {};
        const used = Math.max(0, Number(result.bytes) || 0);
        bytes -= used; stats.uploadedBytes += used;
        jobs.delete(job.key);
        removeOrdered(job);
        if (result.done) { stats.completed++; job.resolve(result.value); }
        else { jobs.set(job.key, job); insertOrdered(job); } // Round-robin within each priority.
      } catch (error) { jobs.delete(job.key); removeOrdered(job); job.dispose?.(); job.reject(error); }
    }
    const elapsed = now() - start;
    stats.frames++; stats.maxFrameMs = Math.max(stats.maxFrameMs, elapsed);
    if (elapsed > 2) stats.overrunCount++;
    schedule();
  }
  function cancelWhere(predicate) {
    for (const [key, job] of jobs) if (predicate(job)) {
      jobs.delete(key); removeOrdered(job); job.dispose?.(); stats.cancelled++;
      job.reject(Object.assign(new Error('GPU upload cancelled'), { name: 'AbortError' }));
    }
  }
  return Object.freeze({
    enqueueUpload(input) {
      if (disposed) return Promise.reject(new Error('GPU upload scheduler disposed'));
      if (jobs.has(input.key)) return jobs.get(input.key).promise;
      const job = { priority: 0, ...input };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      jobs.set(job.key, job); insertOrdered(job); schedule(); return job.promise;
    },
    noteInput(value = false) { active = value === true; lastInput = now(); schedule(); },
    defer() { lastInput = now(); schedule(); },
    cancelGeneration(generation) { cancelWhere(job => job.projectGeneration === generation); },
    cancelKey(key) { cancelWhere(job => job.key === key); },
    cancelAll() { cancelWhere(() => true); },
    getStats: () => ({ ...stats, pending: jobs.size, active }),
    dispose() { disposed = true; if (frame) cancelFrame(frame); frame = 0; cancelWhere(() => true); },
  });
}
