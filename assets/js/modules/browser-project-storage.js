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

