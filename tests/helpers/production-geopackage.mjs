import {repositoryFrontendSnapshot,nodeWorkerScript} from './frontend-source.mjs';
import { TextEncoder, TextDecoder } from 'node:util';
import { atob, btoa } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createNodeCoreProject } from './core-project.mjs';
const sqlDir = new URL('../../shared/frontend/js/vendor/sql/', import.meta.url);
const sqlContext = vm.createContext({ module: { exports: {} }, require: createRequire(import.meta.url), process,
  __dirname: fileURLToPath(sqlDir), Buffer, console, TextEncoder, TextDecoder });
vm.runInContext(readFileSync(new URL('sql-wasm.js', sqlDir), 'utf8'), sqlContext);
const SQL = await sqlContext.initSqlJs({ wasmBinary: readFileSync(new URL('sql-wasm.wasm', sqlDir)) });
export { SQL as productionSql };
const snapshot=await repositoryFrontendSnapshot();
const workerUrl=new URL('https://fixture.invalid/assets/js/workers/gis-gpkg-worker.js');
const worker=vm.createContext({URL,console,TextEncoder,TextDecoder,structuredClone,Uint8Array,DataView,atob,btoa,initSqlJs:async()=>SQL,location:{href:workerUrl.href}});worker.self=worker;
const dynamic=vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER;
worker.importScripts=(...urls)=>{for(const url of urls){const path=new URL(url,workerUrl).pathname.slice(1);if(path.endsWith('/sql-wasm.js'))continue;const entry=snapshot.assets.get(path);if(!entry)throw Error('Unowned Worker script: '+path);vm.runInContext(nodeWorkerScript(snapshot,path),worker,{filename:new URL(path,'https://fixture.invalid/').href,importModuleDynamically:dynamic});}};
vm.runInContext(nodeWorkerScript(snapshot,'assets/js/workers/gis-gpkg-worker.js'),worker,{filename:workerUrl.href,importModuleDynamically:dynamic});

export async function productionGeoPackage(action, buffer, projectState,spatialState) {
  let message;
  worker.postMessage = value => { message = value; };
  await worker.onmessage({ data: { id: 1, action, buffer, projectState,spatialState, exportMode: 'project' } });
  if (!message.ok) throw Object.assign(new Error(message.error), { code: message.code });
  return message;
}

/** Current fixture encoders consume the same explicit C++ file receipt as the app. */
export async function coreFileProjection(project) {
  const owner=await createNodeCoreProject(project);
  try {
    const result=await owner.client.exportSnapshot({format:'pandolab-project-state',version:project.version,savedAt:project.savedAt});
    return {project:JSON.parse(result.storageJson),spatialState:result.spatialState};
  } finally {owner.dispose();}
}

export function spatialLayerCount(buffer) {
  const db = new SQL.Database(new Uint8Array(buffer));
  try { return db.exec("SELECT count(*) FROM gpkg_contents WHERE data_type='features'")[0].values[0][0]; } finally { db.close(); }
}

export function spatialColumns(buffer, table) {
  if (!['entities','regions','generic_features_point','generic_features_line','generic_features_polygon'].includes(table)) throw new Error('Unexpected table');
  const db=new SQL.Database(new Uint8Array(buffer));
  try { return db.exec(`PRAGMA table_info(${table})`)[0].values.map(row=>row[1]); } finally { db.close(); }
}
