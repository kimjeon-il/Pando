import { preparedCountrySceneKey } from '../rendering/country-mesh-codec.js';

/** The existing resource owner delivers one immutable prepared scene, not a document. */
export function createBuiltinMeshResourceLoader({runtimeAssetUrl,WorkerClass=Worker}={}) {
  if(typeof runtimeAssetUrl!=='function')throw new TypeError('runtimeAssetUrl is required for the built-in mesh loader.');
  const pending=new Map();let retained=null,lastMiss=null,disposed=false;
  const cancellation=()=>Object.assign(new Error('Built-in mesh loader disposed'),{name:'AbortError'});
  function load(sceneIdentity) {
    if(disposed)return Promise.reject(cancellation());
    let key;
    try {key=preparedCountrySceneKey(sceneIdentity);}catch(error){return Promise.reject(error);}
    if(retained?.key===key)return Promise.resolve(retained.value);
    if(lastMiss===key)return Promise.resolve(null);
    if(pending.has(key))return pending.get(key).promise;
    let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const entry={promise,worker:null,live:true,cancel:()=>finish(cancellation())};
    function finish(error,value=null) {
      if(!entry.live)return;
      entry.live=false;entry.worker?.terminate();pending.delete(key);
      if(error)reject(error);else resolve(value);
    }
    pending.set(key,entry);
    try {
      const worker=entry.worker=new WorkerClass(runtimeAssetUrl('workers/data-loader-worker.js?mode=builtin-mesh-only'),
        {type:'module',name:'pandolab-builtin-mesh-resource'});
      worker.onmessage=({data:message})=>{
        if(!entry.live||disposed)return;
        if(message?.type==='builtin-mesh-loader-ready')worker.postMessage({type:'load-builtin-mesh',sceneIdentity});
        else if(message?.type==='builtin-mesh-miss'){lastMiss=key;finish(null);}
        else if(message?.type==='builtin-mesh-ready'){
          if(message.identity?.sceneKey!==key||!/^[a-f0-9]{64}$/.test(message.identity?.hash||'')){
            finish(new Error('Prepared country scene identity mismatch'));return;
          }
          const value=Object.freeze({meshBuffer:message.meshBuffer,preparedStroke:message.preparedStroke,
            spatialBlocks:message.spatialBlocks,boundaryPacket:message.boundaryPacket,identity:message.identity});
          retained={key,value};finish(null,value);
        }else if(message?.type==='builtin-mesh-error')finish(new Error(message.message||'내장 기본 메시를 준비하지 못했습니다.'));
      };
      worker.onerror=event=>finish(new Error(event.message||'내장 기본 메시 Worker 오류'));
    }catch(error){finish(error);}
    return promise;
  }
  return Object.freeze({load,dispose(){
    if(disposed)return;disposed=true;
    for(const entry of [...pending.values()])entry.cancel();
    retained=null;lastMiss=null;
  }});
}
// @worker-transport dedicated: builtin mesh cache delivery owns its streaming resource protocol
