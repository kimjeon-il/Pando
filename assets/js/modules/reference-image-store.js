const DB_NAME = 'pandolab-reference-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function openDatabase() {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('참조 이미지 저장소를 열 수 없습니다.'));
  });
}

function withStore(mode, operation) {
  return openDatabase().then(database => {
    if (!database) return operation(null);
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let value;
      try {
        value = operation(store);
      } catch (error) {
        database.close();
        reject(error);
        return;
      }
      transaction.oncomplete = () => {
        database.close();
        resolve(value);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error || new Error('참조 이미지 저장소 작업에 실패했습니다.'));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error || new Error('참조 이미지 저장소 작업이 취소되었습니다.'));
      };
    });
  });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('참조 이미지 저장소 요청에 실패했습니다.'));
  });
}

export async function listStoredReferenceImages() {
  if (!hasIndexedDb()) return [];
  const database = await openDatabase();
  if (!database) return [];
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const values = await requestValue(store.getAll());
    return Array.isArray(values) ? values : [];
  } finally {
    database.close();
  }
}

export function putStoredReferenceImage(record) {
  if (!record?.id) return Promise.reject(new TypeError('참조 이미지 id가 필요합니다.'));
  return withStore('readwrite', store => {
    if (!store) return false;
    store.put(record);
    return true;
  });
}

export function deleteStoredReferenceImage(id) {
  const key = String(id || '').trim();
  if (!key) return Promise.resolve(false);
  return withStore('readwrite', store => {
    if (!store) return false;
    store.delete(key);
    return true;
  });
}

export function clearStoredReferenceImages() {
  return withStore('readwrite', store => {
    if (!store) return false;
    store.clear();
    return true;
  });
}
