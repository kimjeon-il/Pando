import { createBrowserProjectStorage } from './browser-project-storage.js';
import { packReferenceImages, unpackReferenceImages } from './reference-image-package.js';

export const REFERENCE_IMAGE_COLLECTION_VERSION = 2;
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
    if (value === null) return { version: REFERENCE_IMAGE_COLLECTION_VERSION, records: [] };
    if (
      !value
      || value.version !== REFERENCE_IMAGE_COLLECTION_VERSION
      || !Array.isArray(value.records)
    ) {
      throw new Error('참조 이미지 저장 목록을 읽을 수 없습니다. 원본을 보존했습니다.');
    }
    return value;
  }

  function mutateCollection(mutator) {
    const run = mutationQueue.then(async () => {
      const collection = await readCollection();
      const records = mutator([...collection.records]);
      if (!Array.isArray(records)) throw new TypeError('참조 이미지 목록이 필요합니다.');
      await projectStorage.writeProject({
        version: REFERENCE_IMAGE_COLLECTION_VERSION,
        records,
      });
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

let collectionOwner = null;
let contentRevision = 0, savedRevision = 0;
export function markReferenceImageCollectionChanged() { contentRevision += 1; }
/** The mounted controller owns live records; storage supplies them before the tool is mounted. */
export function registerReferenceImageCollection(owner) {
  if (collectionOwner || typeof owner?.capture !== 'function' || typeof owner?.replace !== 'function') throw new TypeError('A single reference image collection owner is required.');
  collectionOwner = owner;
  return () => { if (collectionOwner === owner) collectionOwner = null; };
}
export const referenceImageProjectAssets = Object.freeze({
  state: () => ({ revision: contentRevision, dirty: contentRevision !== savedRevision }),
  markSaved(revision) { if (revision === contentRevision) savedRevision = revision; },
  restoreState(state) { contentRevision += 1;savedRevision = state.dirty ? -1 : contentRevision; },
  capture: () => collectionOwner ? collectionOwner.capture() : imageStore.list(),
  prepare: unpackReferenceImages,
  async exportPackage() { return packReferenceImages(await this.capture()); },
  async replace(records) {
    if (collectionOwner) await collectionOwner.replace(records);
    else await imageStore.replace(records);
    contentRevision += 1;
  },
});
