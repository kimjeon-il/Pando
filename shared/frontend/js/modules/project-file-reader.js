// @worker-transport dedicated: one transferable GeoPackage read, terminated after its reply
import { applyImportedPackageAssets } from './project-package-assets.js';
import {workerAssetUrl} from './worker-asset-url.js';

export async function readProjectFile(file) {
  if (!/\.gpkg$/i.test(file.name)) throw new Error('현재 형식의 .gpkg 프로젝트를 선택하세요.');
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerAssetUrl(new URL('../workers/project-read-worker.js', import.meta.url)));
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
