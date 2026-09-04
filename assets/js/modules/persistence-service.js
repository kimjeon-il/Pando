import { AUTOSAVE_STATES } from './save-state-controller.js';
import { PERFORMANCE_METRIC_NAMES, getRuntimePerformanceMetrics } from './runtime-performance-metrics.js';

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
    });
    return databasePromise;
  }

  async function readRecord(key, errorMessage) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(key);
      transaction.oncomplete = () => resolve(request.result || null);
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
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('자동저장 삭제 실패'));
    });
  }

  function readFallback() {
    try {
      const raw = localStorage.getItem(fallbackKey);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
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
    writeProject: project => writeRecord(projectKey, project, '자동저장 쓰기 실패'),
    writeView: view => writeRecord(viewKey, view, '보기 위치 저장 실패'),
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
  now = () => new Date(),
}) {
  async function persist(project = null) {
    if (!canPersist()) return;
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
        detail.indexedDbMs = metricNow() - writeStartedAt;
        detail.outcome = 'indexeddb';
        onSaved(now());
        onAutosaveState(AUTOSAVE_STATES.SAVED);
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

  function queueProject(delay = 650, { scope = 'document' } = {}) {
    if (!canPersist()) return;
    onDirty(scope);
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

  async function restore() {
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
      try {
        const project = await storage.readProject();
        if (project) {
          validateProject(project);
          outcome = 'indexeddb';
          return { project, source: 'indexeddb', view };
        }
      } catch (error) {
        onWarning('IndexedDB autosave rejected', error);
        rejectedError = error;
      }
      const local = storage.readFallback();
      if (!local) return { project: null, source: null, error: rejectedError, view };
      try {
        validateProject(local);
      } catch (error) {
        onWarning('Local autosave rejected', error);
        outcome = 'rejected';
        return { project: null, source: null, error, view };
      }
      try {
        await storage.writeProject(local);
        storage.removeFallback();
      } catch (_) {}
      outcome = 'localstorage';
      return { project: local, source: 'localstorage', view };
    } finally {
      recordMetric('autosave.restore', startedAt, { outcome, restoredView: !!view, rejected: !!rejectedError });
    }
  }

  async function clear() {
    scheduler.cancel('autosave');
    try {
      await storage.deleteRecords();
    } catch (_) {}
    storage.removeFallback();
  }

  const writeProject = project => storage.writeProject(project);

  return Object.freeze({ persist, writeProject, queueProject, queuePresentation, queueView, restore, clear });
}
