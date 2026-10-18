import { createStoredAssetLoader } from './stored-asset-loader.js';
import { applyImportedPackageAssets } from './project-package-assets.js';

export async function readBuiltinProject(meta) {
  const loader = createStoredAssetLoader({ dataRevision: meta.dataRevision, resolveUrl: spec => spec.url });
  const decode = bytes => JSON.parse(new TextDecoder().decode(bytes));
  const { value: manifest } = await loader.loadAsset(meta.historicalWorld, 'history', 'manifest', '지도 목록', decode);
  const { value } = await loader.loadAsset(manifest.project, 'history', 'project', '내장 지도', decode);
  return value;
}

export async function readProjectFile(file) {
  if (!/\.gpkg$/i.test(file.name)) throw new Error('현재 형식의 .gpkg 프로젝트를 선택하세요.');
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/project-read-worker.js', import.meta.url));
    const finish = (error, value) => { worker.terminate(); error ? reject(error) : resolve(value); };
    worker.onerror = event => finish(new Error(event.message || '프로젝트 읽기에 실패했습니다.'));
    worker.onmessage = ({ data }) => {
      if (!data.ok) { finish(new Error(data.error)); return; }
      try {
        const project = data.metadata.projectState;
        finish(null, { ...project, territorialEntities: applyImportedPackageAssets(data.metadata, project.territorialEntities) });
      } catch (error) { finish(error); }
    };
    worker.postMessage({ action: 'read', buffer }, [buffer]);
  });
}
