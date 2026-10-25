import { AUTOSAVE_STATES } from './save-state-controller.js';
import { PERFORMANCE_METRIC_NAMES, getRuntimePerformanceMetrics } from "../../../../../shared/frontend/js/modules/runtime-performance-metrics.js";
import { createProjectPreviewCache } from './project-preview-cache.js';

const metricNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const recordMetric = (name, startedAt, detail = {}) => {
  getRuntimePerformanceMetrics()?.record?.(name, metricNow() - startedAt, detail);
};

export function createPersistenceService({
  storage,
  scheduler,
  canPersist,
  buildAutosave,
  readView,
  validateProject,
  onDirty,
  onAutosaveState,
  onSaved,
  onFailure,
  onWarning = () => {},
  onRecoveryState = () => {},
  previewGeometry = null,
  previewProjection = null,
  previewBaseline = () => null,
  now = () => new Date(),
}) {
  let writeTail = Promise.resolve();
  let queuedAutosave = null;
  let persistenceEpoch = 0;
  let recovery = null;
  let restoring = false;
  let resolving = false;
  let activeDocumentId=null;
  let lastPreviewContentRevision = null;
  const documentId=project=>typeof project?.documentId==='string'?project.documentId:null;
  const scopedView=(view,project)=>view && documentId(project) && view.documentId===documentId(project)?view:null;
  const getRecovery = () => recovery ? structuredClone(recovery) : null;
  const setRecovery = value => {
    recovery = value;
    onRecoveryState(getRecovery());
  };
  const previewCache = previewGeometry && storage.readPreview && storage.writePreview
    ? createProjectPreviewCache({ storage, scheduler, getGeometry: previewGeometry,
      getBaseline: previewBaseline, getPreviewSource:previewProjection, onWarning }) : null;
  function persist(snapshot = null) {
    if (!snapshot && queuedAutosave) return queuedAutosave;
    const epoch = persistenceEpoch;
    const pending = writeTail.then(() => {
      if (queuedAutosave === pending) queuedAutosave = null;
      if (epoch !== persistenceEpoch) return;
      return persistOne(snapshot, epoch);
    });
    if (!snapshot) queuedAutosave = pending;
    writeTail = pending.catch(() => {});
    return pending;
  }

  async function persistOne(snapshot, epoch) {
    if (recovery || restoring || !canPersist()) return;
    const startedAt = metricNow();
    const detail = {
      outcome: 'building',
      format: '',
      buildMs: 0,
      indexedDbMs: 0,
      fallbackMs: 0,
    };
    try {
      const buildStartedAt = metricNow();
      const receipt = await (snapshot ?? buildAutosave());
      detail.buildMs = metricNow() - buildStartedAt;
      // The checkpoint is operation evidence, never part of the saved format.
      if (!receipt || typeof receipt !== 'object' || !Object.hasOwn(receipt, 'checkpoint')
        || !receipt.project || typeof receipt.project !== 'object' || Array.isArray(receipt.project))
        throw new TypeError('An autosave snapshot receipt {project, checkpoint} is required.');
      if (epoch !== persistenceEpoch || recovery || restoring || !canPersist()) {
        detail.outcome = 'discarded';
        return;
      }
      const autosaveProject = receipt.project;
      detail.format = String(autosaveProject?.format || 'unknown');
      onAutosaveState(AUTOSAVE_STATES.SAVING);
      let fallback = false;
      detail.outcome = 'writing';
      try {
        const writeStartedAt = metricNow();
        await storage.writeProject(autosaveProject);
        if (epoch !== persistenceEpoch) { detail.outcome = 'discarded'; return; }
        storage.removeFallback();
        detail.indexedDbMs = metricNow() - writeStartedAt;
        detail.outcome = 'indexeddb';
      } catch (error) {
        if (epoch !== persistenceEpoch) { detail.outcome = 'discarded'; return; }
        try {
          const fallbackStartedAt = metricNow();
          storage.writeFallback(autosaveProject);
          detail.fallbackMs = metricNow() - fallbackStartedAt;
          detail.outcome = 'localstorage';
          detail.indexedDbError = String(error?.name || error?.code || 'error');
          fallback = true;
        } catch (fallbackError) {
          detail.outcome = 'failed';
          detail.indexedDbError = String(error?.name || error?.code || 'error');
          detail.fallbackError = String(fallbackError?.name || fallbackError?.code || 'error');
          onWarning('Autosave failed', error, fallbackError);
          onAutosaveState(AUTOSAVE_STATES.ERROR);
          onFailure(error, fallbackError);
          return;
        }
      }
      // A Core checkpoint acknowledgement failure happens AFTER the device
      // write. It must not trigger another write through the storage fallback.
      detail.outcome = 'acknowledging';
      const acknowledged = await onSaved(now(), receipt);
      if (epoch !== persistenceEpoch || acknowledged === false) {
        detail.outcome = 'stale-acknowledgement';
        return;
      }
      detail.outcome = fallback ? 'localstorage' : 'indexeddb';
      if (fallback) onAutosaveState(AUTOSAVE_STATES.SAVED, { fallback: '브라우저 로컬 저장소' });
      else onAutosaveState(AUTOSAVE_STATES.SAVED);
      activeDocumentId = documentId(autosaveProject);
      queueView();
      // Geometry preview is independent of presentation-only and session
      // persistence. A Core content checkpoint plus project generation and
      // baseline identifies an unchanged preview source without inspection.
      const checkpoint = receipt.checkpoint;
      const baselineRevision = previewCache ? previewBaseline()?.sourceSha256 : null;
      const previewRevision = baselineRevision && Number.isSafeInteger(checkpoint?.projectGeneration)
        && Number.isSafeInteger(checkpoint?.content)
        ? `${checkpoint.projectGeneration}:${checkpoint.content}:${baselineRevision}` : null;
      if (previewCache && (!previewRevision || previewRevision !== lastPreviewContentRevision)) {
        previewCache.schedule(autosaveProject, checkpoint);
        lastPreviewContentRevision = previewRevision;
      }
    } catch (error) {
      if (error.cancelled || (epoch !== persistenceEpoch && error.name === 'AbortError')) {
        detail.outcome = 'discarded-failure';
        return;
      }
      if (epoch !== persistenceEpoch) detail.outcome = 'discarded-failure';
      else if (detail.outcome === 'acknowledging') {
        detail.outcome = 'acknowledgement-failed';
        onWarning('Autosave checkpoint acknowledgement failed', error);
        onAutosaveState(AUTOSAVE_STATES.ERROR);
        onFailure(error);
      } else {
        detail.outcome = 'build-failed';
        onWarning('Autosave snapshot build failed', error);
        onAutosaveState(AUTOSAVE_STATES.ERROR);
        onFailure(error);
      }
      detail.buildError = String(error?.name || error?.code || 'error');
      throw error;
    } finally {
      recordMetric(PERFORMANCE_METRIC_NAMES.AUTOSAVE, startedAt, detail);
    }
  }

  function queueProject(delay = 650, { scope = 'document', markDirty = true } = {}) {
    if (!canPersist()) return;
    if (markDirty) onDirty(scope);
    if (recovery || restoring) return;
    onAutosaveState(AUTOSAVE_STATES.QUEUED);
    scheduler.scheduleIdle('autosave', () => persist().catch(error => onWarning('Autosave operation failed', error)), delay);
  }

  function queuePresentation(delay = 650) {
    queueProject(delay, { scope: 'presentation' });
  }

  function queueView(delay = 120) {
    const expectedEpoch = persistenceEpoch;
    const expectedId=readView()?.documentId || activeDocumentId;
    scheduler.scheduleIdle('view-autosave', () => {
      const startedAt = metricNow();
      // Order light session writes after any active full document write so
      // their savedAt identity always refers to the latest persisted project.
      const pending = writeTail.then(async () => {
        if (expectedEpoch !== persistenceEpoch || restoring || recovery || !canPersist()) return false;
        const view = readView() || {};
        if(!expectedId || view.documentId!==expectedId)return false;
        await storage.writeView({ ...view,documentId:expectedId,
          savedAt: now().toISOString() });
        return true;
      });
      writeTail = pending.catch(() => {});
      return pending.then(written => {
        if (written) recordMetric('autosave.view', startedAt, { outcome: 'indexeddb' });
      }).catch(error => {
        recordMetric('autosave.view', startedAt, { outcome: 'failed', error: String(error?.name || error?.code || 'error') });
        onWarning('View autosave failed', error);
      });
    }, delay);
  }

  async function restore({ deferResolution = false } = {}) {
    if (restoring || resolving) throw new Error('저장본 복원이 이미 진행 중입니다.');
    restoring = true;
    cancelPending();
    await writeTail;
    const startedAt = metricNow();
    let outcome = 'empty';
    let rejectedError = null;
    let view = null;
    try {
      const reads = await Promise.allSettled([
        storage.readProject(), Promise.resolve().then(() => storage.readFallback()),
      ]);
      const candidates = [];
      let readError = null;
      for (const [index, result] of reads.entries()) {
        const source = index === 0 ? 'indexeddb' : 'localstorage';
        if (result.status === 'rejected') {
          readError = result.reason;
          onWarning(`${source} autosave read failed`, result.reason);
          continue;
        }
        if (result.value == null) continue;
        try {
          await validateProject(result.value);
          candidates.push({ source, project: result.value });
        } catch (error) {
          rejectedError = error;
          onWarning(`${source} autosave rejected`, error);
        }
      }
      if (readError) {
        setRecovery({ kind: 'read-error', candidates, view });
        return { project: null, source: null, error: readError, view: scopedView(view, null) };
      }
      let chosen = candidates[0];
      if (candidates.length === 2) {
        const [db, local] = candidates;
        const stableContent = (value, root = true) => {
          if (Array.isArray(value)) return value.map(entry => stableContent(entry, false));
          if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
            .filter(key => !root || key !== 'savedAt').map(key => [key, stableContent(value[key], false)]));
          return value;
        };
        const timestamp = value => {
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
          const time = Date.parse(value);
          const day = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
          if (!Number.isFinite(time) || !Number.isFinite(day)
            || new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)
            || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return NaN;
          return time;
        };
        const dbTime = timestamp(db.project.savedAt);
        const localTime = timestamp(local.project.savedAt);
        const same = JSON.stringify(stableContent(db.project)) === JSON.stringify(stableContent(local.project));
        if (!same && (!Number.isFinite(dbTime) || !Number.isFinite(localTime) || dbTime === localTime)) {
          setRecovery({ kind: 'conflict', candidates, view });
          outcome = 'conflict';
          return { project: null, source: null, view: scopedView(view, null) };
        }
        if (Number.isFinite(localTime) && (!Number.isFinite(dbTime) || localTime > dbTime)) chosen = local;
      }
      if (deferResolution && chosen && !rejectedError) {
        setRecovery({ kind: 'conflict', candidates: [chosen], view });
        return { project: null, source: null, view: scopedView(view, null) };
      }
      if(chosen)try{view=await storage.readView(chosen.project.documentId);}catch(error){onWarning('Project workspace restore failed',error);}
      setRecovery(rejectedError?{kind:'unsupported',candidates,view:null}:null);
      if (!chosen) return { project: null, source: null, error: rejectedError, view: scopedView(view, null) };
      if (!rejectedError && (chosen.source === 'localstorage' || candidates.length === 2)) {
        try {
          await storage.writeProject(chosen.project);
          storage.removeFallback();
        } catch (error) { onWarning('Autosave promotion failed; fallback retained', error); }
      }
      outcome = chosen.source;
      activeDocumentId = documentId(chosen.project);
      return { ...chosen, view: scopedView(view, chosen.project) };
    } finally {
      restoring = false;
      recordMetric('autosave.restore', startedAt, { outcome, restoredView: !!view, rejected: !!rejectedError });
    }
  }

  async function commitRecovery(result) {
    try {
      await storage.writeProject(result.project);
      storage.removeFallback();
    } catch (error) {
      onWarning('Chosen autosave IndexedDB write failed', error);
      storage.writeFallback(result.project);
    }
    setRecovery(null);
    activeDocumentId = documentId(result.project);
    queueView();
  }

  async function completeRecovery() {
    if (!recovery?.selectedSource) return;
    if (resolving || restoring) throw new Error('저장본 복원이 이미 진행 중입니다.');
    resolving = true;
    try {
      await commitRecovery(recovery.candidates.find(candidate => candidate.source === recovery.selectedSource));
    } finally { resolving = false; }
  }

  async function resolveRecovery(source, apply = async () => {}, { deferApplication = false } = {}) {
    if (!recovery || recovery.kind !== 'conflict' || resolving) throw new Error('해결할 저장본 충돌이 없습니다.');
    const pending = recovery;
    const chosen = pending.candidates.find(candidate => candidate.source === source);
    if (!chosen) throw new Error('복원할 저장본을 선택하세요.');
    resolving = true;
    try {
      await storage.writeRecovery({ savedAt: now().toISOString(),
        candidates: pending.candidates.filter(candidate => candidate !== chosen) });
      const result = { ...structuredClone(chosen), view: structuredClone(scopedView(pending.view, chosen.project)) };
      if (deferApplication) {
        setRecovery({ ...pending, selectedSource: source });
        return result;
      }
      await apply(result.project, result.view);
      await commitRecovery(result);
      return result;
    } finally { resolving = false; }
  }

  function cancelPending() {
    persistenceEpoch += 1;
    previewCache?.cancel();
    queuedAutosave = null;
    activeDocumentId = null;
    lastPreviewContentRevision = null;
    scheduler.cancel('autosave');
    scheduler.cancel('view-autosave');
  }

  async function clear() {
    if (recovery || restoring) throw new Error('저장본 선택을 먼저 완료하세요.');
    cancelPending();
    await writeTail;
    await storage.deleteRecords();
    storage.removeFallback();
  }

  return Object.freeze({ persist, queueProject, queuePresentation, queueView, restore, clear, cancelPending,
    getRecovery, resolveRecovery, completeRecovery,
    restorePreview: (project, preparedSource = null) => previewCache?.restore(project, preparedSource) ?? Promise.resolve(null),
    ensurePreview: project => previewCache?.schedule(project),
  });
}
