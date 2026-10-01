import { createBrowserProjectStorage } from './persistence-service.js';

const COLLECTION_VERSION = 1;
const COLLECTION_KEY = 'reference-images';

const storage = createBrowserProjectStorage({
  indexedDB: globalThis.indexedDB,
  localStorage: globalThis.localStorage,
  databaseName: 'pandolab-reference-images',
  storeName: 'state-v2',
  projectKey: COLLECTION_KEY,
  viewKey: 'reference-images-view',
  fallbackKey: 'pandolab-reference-images-fallback',
  databaseVersion: 2,
});

export function createReferenceImageStore(projectStorage) {
  let mutationQueue = Promise.resolve();
  async function readCollection() {
    const value = await projectStorage.readProject();
    if (value === null) return { version: COLLECTION_VERSION, records: [] };
    if (!value || value.version !== COLLECTION_VERSION || !Array.isArray(value.records)) {
      throw new Error('참조 이미지 저장 목록을 읽을 수 없습니다. 원본을 보존했습니다.');
    }
    return value;
  }
  function mutateCollection(mutator) {
    const run = mutationQueue.then(async () => {
      const collection = await readCollection();
      const records = mutator([...collection.records]);
      if (!Array.isArray(records)) throw new TypeError('참조 이미지 목록이 필요합니다.');
      await projectStorage.writeProject({ version: COLLECTION_VERSION, records });
      return true;
    });
    mutationQueue = run.catch(() => {});
    return run;
  }
  return Object.freeze({
    list: async () => [...(await readCollection()).records],
    put: record => {
      if (!record?.id) return Promise.reject(new TypeError('참조 이미지 id가 필요합니다.'));
      return mutateCollection(records => {
        const index = records.findIndex(candidate => candidate?.id === record.id);
        if (index >= 0) records[index] = record;
        else records.push(record);
        return records;
      });
    },
    replace: records => {
      if (!Array.isArray(records)) return Promise.reject(new TypeError('참조 이미지 목록이 필요합니다.'));
      const values = [...records];
      return mutateCollection(() => values);
    },
  });
}

const imageStore = createReferenceImageStore(storage);
export const listStoredReferenceImages = imageStore.list;
export const putStoredReferenceImage = imageStore.put;
export const replaceStoredReferenceImages = imageStore.replace;
