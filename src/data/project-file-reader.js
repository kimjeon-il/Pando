// @worker-transport dedicated: one transferable GeoPackage read, terminated after its reply
import { applyImportedPackageAssets, validateImportedProjectPackage } from "./project-package-assets.js";
import {workerAssetUrl} from "../runtime/worker-asset-url.js";

export async function readProjectFile(file) {
  if (!/\.gpkg$/i.test(file.name)) throw new Error('현재 형식의 .gpkg 프로젝트를 선택하세요.');
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerAssetUrl(new URL("./workers/project-read-worker.js", import.meta.url)));
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      error ? reject(error) : resolve(value);
    };
    worker.onerror = event => finish(new Error(event.message || '프로젝트 읽기에 실패했습니다.'));
    worker.onmessageerror = () => finish(new Error('프로젝트 응답을 읽지 못했습니다.'));
    worker.onmessage = ({ data }) => {
      if (settled) return;
      try {
        if (!data?.ok) throw new Error(data?.error || '프로젝트 읽기에 실패했습니다.');
        const project = validateImportedProjectPackage(data.metadata);
        const territorialEntities = applyImportedPackageAssets(data.metadata, project.territorialEntities);
        finish(null, territorialEntities === project.territorialEntities
          ? project : { ...project, territorialEntities });
      } catch (error) { finish(error); }
    };
    try { worker.postMessage({ action: 'read', buffer }, [buffer]); }
    catch (error) { finish(error); }
  });
}
