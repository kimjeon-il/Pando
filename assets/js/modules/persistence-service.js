import { AUTOSAVE_STATES } from './save-state-controller.js';
import { PERFORMANCE_METRIC_NAMES, getRuntimePerformanceMetrics } from './runtime-performance-metrics.js';
import { createProjectPreviewCache } from './project-preview-cache.js';

const metricNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const recordMetric = (name, startedAt, detail = {}) => {
  getRuntimePerformanceMetrics()?.record?.(name, metricNow() - startedAt, detail);
};

export function createBrowserProjectStorage({
  indexedDB,
  localStorage,
  databaseName,
  storeName,
  projectKey,
  viewKey,
  fallbackKey,
  previewKey = `${projectKey}:preview`,
  databaseVersion = 2,
  fallbackLimit = 4_500_000,
}) {
  let databasePromise = null;

  function openDatabase() {
    if (!indexedDB) return Promise.reject(new Error('IndexedDB를 지원하지 않는 브라우저입니다.'));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB 열기 실패'));
      request.onblocked = () => reject(new Error('다른 창에서 자동저장 DB를 사용 중입니다.'));
    }).catch(error => { databasePromise = null; throw error; });
    return databasePromise;
  }

  async function readRecord(key, errorMessage) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(key);
      transaction.oncomplete = () => resolve(request.result ?? null);
      transaction.onerror = () => reject(transaction.error || new Error(errorMessage));
    });
  }

  async function writeRecord(key, value, errorMessage) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error(errorMessage));
      transaction.onabort = () => reject(transaction.error || new Error(`${errorMessage} 취소`));
    });
  }

  async function deleteRecords() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      store.delete(projectKey);
      store.delete(viewKey);
      store.delete(previewKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('자동저장 삭제 실패'));
    });
  }

  async function deletePreview() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(previewKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('지도 미리보기 삭제 실패'));
    });
  }

  function readFallback() {
    const raw = localStorage.getItem(fallbackKey);
    return raw === null ? null : JSON.parse(raw);
  }

  function writeFallback(project) {
    const serialized = JSON.stringify(project);
    if (serialized.length > fallbackLimit) throw new Error('고해상도 프로젝트가 localStorage 용량을 초과합니다.');
    localStorage.setItem(fallbackKey, serialized);
  }

  function removeFallback() {
    try {
      localStorage.removeItem(fallbackKey);
    } catch (_) {}
  }

  return Object.freeze({
    readProject: () => readRecord(projectKey, '자동저장 읽기 실패'),
    readView: () => readRecord(viewKey, '보기 위치 읽기 실패'),
    readPreview: () => readRecord(previewKey, '지도 미리보기 읽기 실패'),
    writeProject: project => writeRecord(projectKey, project, '자동저장 쓰기 실패'),
    writeRecovery: record => writeRecord(`${projectKey}:recovery:${globalThis.crypto.randomUUID()}`, record, '저장본 복구 기록 쓰기 실패'),
    writeView: view => writeRecord(viewKey, view, '보기 위치 저장 실패'),
    writePreview: preview => writeRecord(previewKey, preview, '지도 미리보기 저장 실패'),
    deletePreview,
    deleteRecords,
    readFallback,
    writeFallback,
    removeFallback,
  });
}

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
  previewBaseline = () => null,
  now = () => new Date(),
}) {
  let writeTail = Promise.resolve();
  let queuedAutosave = null;
  let persistenceEpoch = 0;
  let recovery = null;
  let restoring = false;
  let resolving = false;
  const getRecovery = () => recovery ? structuredClone(recovery) : null;
  const setRecovery = value => {
    recovery = value;
    onRecoveryState(getRecovery());
  };
  const previewCache = previewGeometry && storage.readPreview && storage.writePreview
    ? createProjectPreviewCache({ storage, scheduler, getGeometry: previewGeometry,
      getBaseline: previewBaseline, onWarning }) : null;
  function persist(project = null) {
    if (!project && queuedAutosave) return queuedAutosave;
    const epoch = persistenceEpoch;
    const pending = writeTail.then(() => {
      if (queuedAutosave === pending) queuedAutosave = null;
      if (epoch !== persistenceEpoch) return;
      return persistOne(project);
    });
    if (!project) queuedAutosave = pending;
    writeTail = pending.catch(() => {});
    return pending;
  }

  async function persistOne(project = null) {
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
      const autosaveProject = project || buildAutosave();
      detail.buildMs = metricNow() - buildStartedAt;
      detail.format = String(autosaveProject?.format || 'unknown');
      onAutosaveState(AUTOSAVE_STATES.SAVING);
      try {
        const writeStartedAt = metricNow();
        await storage.writeProject(autosaveProject);
        storage.removeFallback();
        detail.indexedDbMs = metricNow() - writeStartedAt;
        detail.outcome = 'indexeddb';
        onSaved(now());
        onAutosaveState(AUTOSAVE_STATES.SAVED);
        previewCache?.schedule(autosaveProject);
      } catch (error) {
        try {
          const fallbackStartedAt = metricNow();
          storage.writeFallback(autosaveProject);
          detail.fallbackMs = metricNow() - fallbackStartedAt;
          detail.outcome = 'localstorage';
          detail.indexedDbError = String(error?.name || error?.code || 'error');
          onSaved(now());
          onAutosaveState(AUTOSAVE_STATES.SAVED, { fallback: '브라우저 로컬 저장소' });
        } catch (fallbackError) {
          detail.outcome = 'failed';
          detail.indexedDbError = String(error?.name || error?.code || 'error');
          detail.fallbackError = String(fallbackError?.name || fallbackError?.code || 'error');
          onWarning('Autosave failed', error, fallbackError);
          onAutosaveState(AUTOSAVE_STATES.ERROR);
          onFailure(error, fallbackError);
        }
      }
    } catch (error) {
      detail.outcome = 'build-failed';
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
    scheduler.scheduleIdle('autosave', () => persist(), delay);
  }

  function queuePresentation(delay = 650) {
    queueProject(delay, { scope: 'presentation' });
  }

  function queueView(delay = 120) {
    scheduler.scheduleIdle('view-autosave', () => {
      const startedAt = metricNow();
      storage.writeView({ ...readView(), savedAt: now().toISOString() })
        .then(() => recordMetric('autosave.view', startedAt, { outcome: 'indexeddb' }))
        .catch(error => {
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
      try {
        view = await storage.readView();
      } catch (error) {
        onWarning('IndexedDB view restore failed', error);
      }
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
        return { project: null, source: null, error: readError, view };
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
          return { project: null, source: null, view };
        }
        if (Number.isFinite(localTime) && (!Number.isFinite(dbTime) || localTime > dbTime)) chosen = local;
      }
      if (deferResolution && chosen) {
        setRecovery({ kind: 'conflict', candidates: [chosen], view });
        return { project: null, source: null, view };
      }
      setRecovery(null);
      if (!chosen) return { project: null, source: null, error: rejectedError, view };
      if (chosen.source === 'localstorage' || candidates.length === 2) {
        try {
          await storage.writeProject(chosen.project);
          storage.removeFallback();
        } catch (error) { onWarning('Autosave promotion failed; fallback retained', error); }
      }
      outcome = chosen.source;
      return { ...chosen, view };
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
      const result = { ...structuredClone(chosen), view: structuredClone(pending.view) };
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

  const writeProject = project => persist(project);

  return Object.freeze({ persist, writeProject, queueProject, queuePresentation, queueView, restore, clear, cancelPending,
    getRecovery, resolveRecovery, completeRecovery,
    restorePreview: project => previewCache?.restore(project) ?? Promise.resolve(null),
    ensurePreview: project => previewCache?.schedule(project),
  });
}
