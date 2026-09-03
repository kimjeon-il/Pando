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

let mutationQueue = Promise.resolve();

function normalizeCollection(value) {
  if (Array.isArray(value)) return { version: COLLECTION_VERSION, records: value };
  if (!value || typeof value !== 'object') return { version: COLLECTION_VERSION, records: [] };
  return {
    version: Number(value.version) || COLLECTION_VERSION,
    records: Array.isArray(value.records) ? value.records : [],
  };
}

async function readCollection() {
  try {
    return normalizeCollection(await storage.readProject());
  } catch (error) {
    console.warn('[reference-image-store-read]', error);
    return normalizeCollection(null);
  }
}

function mutateCollection(mutator) {
  const run = mutationQueue.then(async () => {
    const collection = await readCollection();
    const nextRecords = mutator([...collection.records]);
    await storage.writeProject({
      version: COLLECTION_VERSION,
      records: Array.isArray(nextRecords) ? nextRecords : collection.records,
    });
    return true;
  });
  mutationQueue = run.catch(() => {});
  return run;
}

export async function listStoredReferenceImages() {
  const collection = await readCollection();
  return [...collection.records];
}

export function putStoredReferenceImage(record) {
  if (!record?.id) return Promise.reject(new TypeError('참조 이미지 id가 필요합니다.'));
  return mutateCollection(records => {
    const index = records.findIndex(candidate => candidate?.id === record.id);
    if (index >= 0) records[index] = record;
    else records.push(record);
    return records;
  });
}

export function deleteStoredReferenceImage(id) {
  const key = String(id || '').trim();
  if (!key) return Promise.resolve(false);
  return mutateCollection(records => records.filter(record => record?.id !== key));
}

export function clearStoredReferenceImages() {
  const run = mutationQueue.then(() => storage.writeProject({ version: COLLECTION_VERSION, records: [] }).then(() => true));
  mutationQueue = run.catch(() => {});
  return run;
}
