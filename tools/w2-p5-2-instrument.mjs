import {instrument as p4} from './w2-p4-2-instrument.mjs';
// Only an in-memory diagnostic snapshot is modified; product sources are read-only.
export function instrument(path,original){
 let s=p4(path,original,{stepBytes:262144,early:true});
 const once=(a,b)=>{if(s.split(a).length!==2)throw Error('P5 anchor '+path+' '+a);s=s.replace(a,b)};
 if(path.endsWith('/country-shared-boundary-worker.js')){
  once('    const key = packetIdentity(message, preparedFeatures);',"    const key = packetIdentity(message, preparedFeatures);performance.mark('W5|'+JSON.stringify({stage:'packet-identity',requestId:message.requestId,projectGeneration:message.projectGeneration,geometryRevision:message.geometryRevision,quality:message.quality,includeOutlines:message.includeOutlines!==false,key}));");
 }
 if(path.endsWith('/viewer-composition.js'))once("onPresented:()=>{get('viewer').dataset.initialLoading='false';map.finishInitialPreview();}","onPresented:()=>{const state=globalThis.__w2Readiness?.();performance.mark('W5|'+JSON.stringify({stage:'initial-presented',generation:state?.generation??null,requestId:state?.requestId??null,boundaryGeneration:state?.boundaryGeneration??null,boundaryQuality:state?.boundaryQuality??null,quality:state?.quality??null,canonicalMeshReady:state?.canonicalMeshReady??null,pendingBoundary:state?.pendingBoundary??null}));get('viewer').dataset.initialLoading='false';map.finishInitialPreview();}");
 return s;
}
