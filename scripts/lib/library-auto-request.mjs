// Optional work/gis-only exact-input request; ordinary notifications are unchanged.
export const REQUEST_PATH='config/library-auto-work-gis-request.json';
const SHA=/^(?!0{40}$)[a-f0-9]{40}$/;
function fail(code){throw Object.assign(Error(code),{code});}
export function resolveWorkGisRequest({repository,ref,before,after,changedPaths,request}){
 if(repository!=='kimjeon-il/Pando'||ref!=='refs/heads/work/gis')fail('REQUEST_BRANCH_NOT_ALLOWED');
 if(!SHA.test(before||'')||!SHA.test(after||''))fail('INVALID_REQUEST_PUSH_SHA');
 if(!Array.isArray(changedPaths)||changedPaths.some(p=>typeof p!=='string'))fail('INVALID_REQUEST_PATHS');
 if(!changedPaths.includes(REQUEST_PATH))return null;
 if(!request||Array.isArray(request)||Object.keys(request).sort().join(',')!=='dataBranch,dataRevision,schemaVersion'||request.schemaVersion!==1||request.dataBranch!=='work/gis'||!SHA.test(request.dataRevision||''))fail('INVALID_WORK_GIS_REQUEST');
 return {branch:'work/gis',revision:request.dataRevision};
}
export function assertRequestedDataHead(requested,actual){
 if(!SHA.test(requested||'')||!SHA.test(actual||''))fail('INVALID_REQUEST_DATA_SHA');
 if(requested!==actual)fail('REQUEST_DATA_HEAD_MOVED');
}
