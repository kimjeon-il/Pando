export function createBrowserProjectStorage({
  productMode,
  indexedDB,
  databaseName,
  storeName,
  viewKey,
  databaseVersion = 2,
}) {
  if(productMode!=='viewer')throw new TypeError('Project storage requires viewer product mode.');
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

  return Object.freeze({
    readView: documentId => readRecord(`${viewKey}:${documentId}`,  '보기 위치 읽기 실패'),
    writeView: view => {if(typeof view.documentId!=='string'||!view.documentId)throw new TypeError('Workspace documentId is required.');return writeRecord(`${viewKey}:${view.documentId}`, view, '보기 위치 저장 실패');},
  });
}
