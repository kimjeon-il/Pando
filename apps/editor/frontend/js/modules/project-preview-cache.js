/** Rebuildable IndexedDB display cache. This Worker never shares the edit Worker. */
import { matchesDefaultPreview } from "../../../../../shared/frontend/js/modules/project-preview-policy.js";
import {workerAssetUrl} from "../../../../../shared/frontend/js/modules/worker-asset-url.js";

export function createProjectPreviewCache({ storage, scheduler, getGeometry, getBaseline, getPreviewSource, onWarning = () => {} }) {
  if(typeof getPreviewSource!=='function')throw new TypeError('Preview caching requires a pure C++ project geometry query.');
  let worker = null;
  let nextId = 0;
  let epoch = 0;
  let inFlight = null;
  const pending = new Map();

  function retireWorker() {
    const retiredWorker = worker;
    // The Worker reference is the callback owner, even across equal cache epochs.
    worker = null;
    if (!retiredWorker) return;
    retiredWorker.onmessage = null;
    // A cancelled importScripts request can still dispatch an ErrorEvent
    // during termination. Keep it inside this cache's error boundary.
    retiredWorker.onerror = event => event.preventDefault?.();
    retiredWorker.terminate();
  }

  function stopWorker(reason = '미리보기 준비가 취소됐습니다.', cancelled = true) {
    retireWorker();
    for (const task of pending.values()) {
      clearTimeout(task.timeout);
      task.reject(Object.assign(new Error(reason), { cancelled }));
    }
    pending.clear();
  }

  function releaseWorkerIfIdle() {
    if (pending.size) return;
    retireWorker();
  }

  function getWorker() {
    if (worker) return worker;
    const url = new URL('../workers/project-preview-worker.js', import.meta.url);
    url.searchParams.set('v', globalThis.PANDOLAB_BUILD_META?.assetRevision || '');
    const currentWorker = new Worker(workerAssetUrl(url));
    worker = currentWorker;
    currentWorker.onmessage = event => {
      if (worker !== currentWorker) return;
      const { id, ok, result, message } = event.data || {};
      const task = pending.get(id);
      if (!task) return;
      pending.delete(id);
      clearTimeout(task.timeout);
      if (ok) task.resolve(result);
      else task.reject(new Error(message || '미리보기 Worker 오류'));
    };
    currentWorker.onerror = event => {
      event.preventDefault?.();
      if (worker !== currentWorker) return;
      stopWorker(event.message || '미리보기 Worker 오류', false);
    };
    return worker;
  }

  function run(type, data) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => stopWorker('미리보기 Worker 시간 초과', false), 60_000);
      pending.set(id, { resolve, reject, timeout });
      try { getWorker().postMessage({ id, type, ...data }); }
      catch (error) { pending.delete(id); clearTimeout(timeout); reject(error); }
    });
  }

  async function restore(project, preparedSource = null) {
    const requestedEpoch = epoch;
    const baseline = getBaseline();
    if (!project || !baseline?.sourceSha256) return null;
    try {
      const cache = await storage.readPreview();
      if (!cache || requestedEpoch !== epoch) return null;
      // Startup already inspected this exact saved project for its first paint.
      const source=preparedSource || await getPreviewSource(project);
      if(requestedEpoch!==epoch)return null;
      const result = await run('validate', { source, baseline, cache });
      return requestedEpoch === epoch ? result : null;
    } catch (error) {
      if (requestedEpoch === epoch && !error.cancelled && error.name !== 'AbortError') onWarning('Project preview cache rejected', error);
      return null;
    } finally {
      releaseWorkerIfIdle();
    }
  }

  async function ensure(project, expectedEpoch = epoch, preparedSource = null, checkpoint = null) {
    const baseline = getBaseline();
    if (!project || !baseline?.sourceSha256 || expectedEpoch !== epoch) return false;
    try {
      const source=preparedSource || await getPreviewSource(project);
      if(expectedEpoch!==epoch || (!preparedSource && matchesDefaultPreview(source,baseline)))return false;
      const key = await run('key', { source, baseline });
      if (expectedEpoch !== epoch) return false;
      const existing = await storage.readPreview();
      if (expectedEpoch !== epoch) return false;
      if (existing?.geometryKey === key && existing?.baseSourceSha256 === baseline.sourceSha256
        && await run('validate', { key, baseline, cache: existing })) return expectedEpoch === epoch;
      if (expectedEpoch !== epoch) return false;
      // With an accepted autosave receipt, the caller can check its Core
      // checkpoint without exporting the entire project a second time.
      const geometry = await getGeometry(project, checkpoint);
      if (expectedEpoch !== epoch || !geometry?.entities?.length) return false;
      // A save can finish while a later edit is already in progress. Only
      // preview the persisted shape, never a newer unsaved state.
      const currentProject = geometry.project;
      if (currentProject && (currentProject !== project || !checkpoint)) {
        const currentSource=await getPreviewSource(currentProject);
        if(expectedEpoch!==epoch || await run('key',{source:currentSource,baseline})!==key)return false;
      }
      // The Worker computed this key above; do not serialize/clone the full
      // inspected project again for validation or mesh generation.
      const cache = await run('build', { key, baseline,
        entities: geometry.entities });
      if (expectedEpoch !== epoch) return false;
      const latest = await storage.readProject();
      if (expectedEpoch !== epoch || !latest) return false;
      // A persisted Core receipt includes a fresh savedAt identity. Usually
      // this is still the same device record; inspect a raced write only.
      const sameSavedRevision = checkpoint && typeof project.savedAt === 'string'
        && latest.savedAt === project.savedAt && latest.format === project.format
        && latest.baseDataset === project.baseDataset;
      if (!sameSavedRevision) {
        const latestSource=await getPreviewSource(latest);
        if(expectedEpoch!==epoch || await run('key',{source:latestSource,baseline})!==key)return false;
      }
      if(expectedEpoch!==epoch)return false;
      await storage.writePreview(cache);
      return expectedEpoch === epoch;
    } catch (error) {
      if (expectedEpoch === epoch && !error.cancelled && error.name !== 'AbortError') onWarning('Project preview cache unavailable', error);
      return false;
    } finally {
      releaseWorkerIfIdle();
    }
  }

  function schedule(project, checkpoint = null) {
    const baseline = getBaseline();
    if (!project || !baseline?.sourceSha256) return;
    epoch += 1;
    if (inFlight) stopWorker();
    const requestedEpoch = epoch;
    scheduler.cancel('project-preview-cache');
    let query;
    query=(async()=>{
      const source=await getPreviewSource(project);
      if(requestedEpoch!==epoch)return;
      if(matchesDefaultPreview(source,baseline)) {
        await storage.deletePreview?.().catch(error=>onWarning('Project preview cache cleanup failed',error));
        return;
      }
      scheduler.scheduleIdle('project-preview-cache',()=>{
        if(requestedEpoch!==epoch)return;
        let work;
        work=ensure(project,requestedEpoch,source,checkpoint).finally(()=>{if(inFlight===work)inFlight=null;});
        inFlight=work;
      },1500);
    })().catch(error=>{
      if(requestedEpoch===epoch && !error.cancelled && error.name!=='AbortError')onWarning('Project preview cache unavailable',error);
    })
      .finally(()=>{if(inFlight===query)inFlight=null;});
    inFlight=query;
  }

  function cancel() {
    epoch += 1;
    scheduler.cancel('project-preview-cache');
    stopWorker();
    inFlight = null;
  }

  return Object.freeze({ restore, ensure, schedule, cancel });
}
// @worker-transport dedicated: project preview cache owns image generation and preview result delivery
