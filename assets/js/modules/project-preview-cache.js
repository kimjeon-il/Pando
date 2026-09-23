/** Rebuildable IndexedDB display cache. This Worker never shares the edit Worker. */
import { matchesDefaultPreview } from './project-preview-policy.js';

export function createProjectPreviewCache({ storage, scheduler, getGeometry, getBaseline, onWarning = () => {} }) {
  let worker = null;
  let nextId = 0;
  let epoch = 0;
  let inFlight = null;
  const pending = new Map();

  function stopWorker(reason = '미리보기 준비가 취소됐습니다.') {
    worker?.terminate();
    worker = null;
    for (const task of pending.values()) {
      clearTimeout(task.timeout);
      task.reject(new Error(reason));
    }
    pending.clear();
  }

  function releaseWorkerIfIdle() {
    if (pending.size) return;
    worker?.terminate();
    worker = null;
  }

  function getWorker() {
    if (worker) return worker;
    const url = new URL('../workers/project-preview-worker.js', import.meta.url);
    url.searchParams.set('v', globalThis.PANDOLAB_BUILD_META?.assetRevision || '');
    worker = new Worker(url.href);
    worker.onmessage = event => {
      const { id, ok, result, message } = event.data || {};
      const task = pending.get(id);
      if (!task) return;
      pending.delete(id);
      clearTimeout(task.timeout);
      if (ok) task.resolve(result);
      else task.reject(new Error(message || '미리보기 Worker 오류'));
    };
    worker.onerror = event => stopWorker(event.message || '미리보기 Worker 오류');
    return worker;
  }

  function run(type, data) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => stopWorker('미리보기 Worker 시간 초과'), 60_000);
      pending.set(id, { resolve, reject, timeout });
      try { getWorker().postMessage({ id, type, ...data }); }
      catch (error) { pending.delete(id); clearTimeout(timeout); reject(error); }
    });
  }

  async function restore(project) {
    const baseline = getBaseline();
    if (!project || !baseline?.sourceSha256) return null;
    try {
      const cache = await storage.readPreview();
      if (!cache) return null;
      return await run('validate', { project, baseline, cache });
    } catch (error) {
      onWarning('Project preview cache rejected', error);
      return null;
    } finally {
      releaseWorkerIfIdle();
    }
  }

  async function ensure(project, expectedEpoch = epoch) {
    const baseline = getBaseline();
    if (!project || !baseline?.sourceSha256 || expectedEpoch !== epoch
      || matchesDefaultPreview(project, baseline)) return false;
    try {
      const key = await run('key', { project, baseline });
      if (expectedEpoch !== epoch) return false;
      const existing = await storage.readPreview();
      if (existing?.geometryKey === key && existing?.baseSourceSha256 === baseline.sourceSha256
        && await run('validate', { project, baseline, cache: existing })) return true;
      const geometry = getGeometry();
      if (!geometry?.features?.length) return false;
      // A save can finish while a later edit is already in progress. Only
      // preview the persisted shape, never a newer unsaved state.
      const currentProject = geometry.project;
      if (currentProject && await run('key', { project: currentProject, baseline }) !== key) return false;
      const cache = await run('build', { project, baseline,
        features: geometry.features, territorialUnits: geometry.territorialUnits || [] });
      if (expectedEpoch !== epoch) return false;
      const latest = await storage.readProject();
      if (!latest || await run('key', { project: latest, baseline }) !== key || expectedEpoch !== epoch) return false;
      await storage.writePreview(cache);
      return true;
    } catch (error) {
      onWarning('Project preview cache unavailable', error);
      return false;
    } finally {
      releaseWorkerIfIdle();
    }
  }

  function schedule(project) {
    const baseline = getBaseline();
    if (!project) return;
    epoch += 1;
    if (inFlight) stopWorker();
    const requestedEpoch = epoch;
    scheduler.cancel('project-preview-cache');
    if (matchesDefaultPreview(project, baseline)) {
      void storage.deletePreview?.().catch(error => onWarning('Project preview cache cleanup failed', error));
      return;
    }
    scheduler.scheduleIdle('project-preview-cache', () => {
      if (requestedEpoch !== epoch) return;
      inFlight = ensure(project, requestedEpoch).finally(() => { inFlight = null; });
    }, 1500);
  }

  function cancel() {
    epoch += 1;
    scheduler.cancel('project-preview-cache');
    stopWorker();
    inFlight = null;
  }

  return Object.freeze({ restore, ensure, schedule, cancel });
}
