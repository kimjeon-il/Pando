import {createWorkerRpcClient} from './worker-rpc.js';
import {workerAssetUrl} from './worker-asset-url.js';
/** Read-only presentation jobs use a Worker that has no command or history handlers. */
export function createMapDisplayClient({getEntities,getRevision,createWorker=()=>new Worker(workerAssetUrl(new URL('../workers/map-display-worker.js',import.meta.url)),{type:'module'})}) {
 const rpc=createWorkerRpcClient({createWorker,getProjectRevision:getRevision,isCurrent:({entry})=>entry.projectRevision===getRevision()});
 return Object.freeze({
  async prepare(payload,options={}) {
   const projectRevision=getRevision();
   const request=payload.kind==='boundaries'?{...payload,entities:payload.entities||getEntities()}:payload;
   return rpc.request('map.display',request,{...options,projectRevision});
  },
  dispose:()=>rpc.stop('map-display-disposed'),
 });
}
