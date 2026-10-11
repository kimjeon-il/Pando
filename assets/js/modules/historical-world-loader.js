import { createStoredAssetLoader } from './stored-asset-loader.js';
import { prepareProjectForStorage } from './project-state.js';

export function createHistoricalWorldLoader({ manifestUrl, manifestSpec, dataRevision, fetchFn = globalThis.fetch, cacheStorage = globalThis.caches }) {
  if (!manifestUrl || !manifestSpec || !/^[a-f0-9]{64}$/.test(manifestSpec.sha256)) throw new Error('역사 기본 세계 manifest 무결성 정보가 없습니다.');
  const assets = createStoredAssetLoader({ dataRevision, fetchFn, cacheStorage, resolveUrl: spec => spec.url });
  const json = buffer => JSON.parse(new TextDecoder().decode(buffer));
  return Object.freeze({ async loadProject() {
    const { value: manifest } = await assets.loadAsset({ ...manifestSpec, url: manifestUrl }, 'history', 'manifest', '역사 지도 목록', buffer => {
      const value = json(buffer), spec = value.project;
      if (value.schemaVersion !== 1 || !/^\d{4}-\d{2}$/.test(value.sourceMonth) || !spec?.url || spec.encoding !== 'gzip'
          || !/^[a-f0-9]{64}$/.test(spec.sha256) || !(spec.compressedBytes > 0) || !(spec.decodedBytes > 0 && spec.decodedBytes <= 64 * 1024 * 1024)) throw new Error('역사 기본 세계 manifest가 올바르지 않습니다.');
      return value;
    });
    const { value: project } = await assets.loadAsset(manifest.project, 'history', 'project', '역사 지도', buffer => prepareProjectForStorage(json(buffer)));
    return { project, manifest };
  } });
}
