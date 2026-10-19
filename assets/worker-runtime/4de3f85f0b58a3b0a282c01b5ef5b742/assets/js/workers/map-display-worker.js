import './worker-rpc-host.js';
import '../modules/polygon-clipping-core.js';
// Install request reception before the compiled calculation module finishes loading.
const displayReady=import('../modules/map-display-preparation.js').then(module=>module.createMapDisplayPreparation());
displayReady.catch(()=>{});
self.PandoLabWorkerRpc.install({handlers:{'map.display':async(payload,context)=>{
 if(!['boundaries','highlight'].includes(payload.kind))throw new TypeError('Unknown map presentation job.');
 const checkpoint=async()=>{context.throwIfCancelled();await new Promise(resolve=>setTimeout(resolve,0));context.throwIfCancelled();};
 const display=await displayReady;context.throwIfCancelled();
 return display.prepare(payload,[],[],checkpoint);
}}});
