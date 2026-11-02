import {instrument as priorInstrument,probe} from './w2-p2-instrument.mjs';
export function instrument(path,source){
 source=source.replaceAll('\r\n','\n');
 const once=(a,b)=>{if(source.split(a).length!==2)throw Error('W3 anchor '+path+' '+a.slice(0,80));source=source.replace(a,b);};
 if(path.endsWith('/country-shared-boundary-worker.js')){
  source=probe+source;
  once('  let applied = false;',"  globalThis.__w2Current=message;__w2Mark('worker-process','start');let applied = false;");
  once('const coreReady =',"__w2Mark('core-load','start');const coreReady =");
  once('const modules = coreReady.then(core => {',"const modules = coreReady.then(core => {__w2Mark('core-load','end');__w2Mark('module-load','start');");
  once('let boundaryState = null;',"modules.then(()=>__w2Mark('module-load','end'),e=>__w2Mark('module-load','error',{error:String(e)}));let boundaryState = null;");
  once('const [{ prepareCountrySharedBoundaryPacket, createCountrySharedBoundaryState },','const [{ prepareCountrySharedBoundaryPacket: originalPreparePacket, createCountrySharedBoundaryState },');
  once('      { changedCountryGeometryIds }, { polygonGeometryDigest }] = await modules;\n    if (deferUnapplied(message)) return;',"      { changedCountryGeometryIds }, { polygonGeometryDigest }] = await modules;\n    const prepareCountrySharedBoundaryPacket=(...args)=>{__w2Mark('packet','start');try{return originalPreparePacket(...args);}finally{__w2Mark('packet','end');}};if (deferUnapplied(message)) return;");
  once('    if (!boundaryState) boundaryState = createCountrySharedBoundaryState();',"    if(!boundaryState){boundaryState=createCountrySharedBoundaryState();for(const method of ['replace','patch']){const original=boundaryState[method].bind(boundaryState);boundaryState[method]=(...args)=>{__w2Mark('state-'+method,'start');try{return original(...args);}finally{__w2Mark('state-'+method,'end',{stats:boundaryState.stats()});}};}}");
  once('    const features = [];',"    __w2Mark('digest-all','start');const features = [];");
  once("    if (message.type === 'replace') {","    __w2Mark('digest-all','end',{featureCount:features.length});if (message.type === 'replace') {");
  if(source.includes('const packetCacheHit ='))once('    const preparedFeatures = boundaryState.features();',"    __w2Mark('packet-prepare-total','start');const preparedFeatures = boundaryState.features();");
  else once('    const packet = prepareCountrySharedBoundaryPacket(',"    __w2Mark('packet-prepare-total','start');const packet = prepareCountrySharedBoundaryPacket(");
  once('    await yieldToMessages();\n    if (!isLatest(message)) return;\n    self.postMessage',"    __w2Mark('packet-prepare-total','end');await yieldToMessages();\n    if (!isLatest(message)) return;\n    self.postMessage");
  const prefix=`
const actualPost=self.postMessage.bind(self);
self.postMessage=(data,transfer)=>{const parts=data.packet?[data.packet,data.packet.outlineOverrides]:[];const bytes=parts.reduce((n,p)=>n+p.startsEnds.byteLength+p.preparedGeometry.instances.byteLength+p.preparedGeometry.nodes.byteLength,0);__w2Mark('result-post','start',{...data,packet:undefined,preparationStats:data.preparationStats,bytes,cacheSupported:Object.hasOwn(data,'packetCacheHit')});actualPost(data,transfer);__w2Mark('result-post','end',{requestId:data.requestId,projectGeneration:data.projectGeneration,geometryRevision:data.geometryRevision,quality:data.quality,cacheSupported:Object.hasOwn(data,'packetCacheHit'),packetCacheHit:Object.hasOwn(data,'packetCacheHit')?data.packetCacheHit:null,residentBytes:typeof retainedPacket==='undefined'?null:retainedPacket?.residentBytes??0,retainedAttached:typeof retainedPacket==='undefined'?null:retainedPacket?[retainedPacket.packet,retainedPacket.packet.outlineOverrides].every(p=>[p.startsEnds,p.preparedGeometry.instances,p.preparedGeometry.nodes].every(a=>a.buffer.detached===false)):null});};
const actualReceive=self.onmessage;self.onmessage=event=>{__w2Mark('worker-receive','instant',{requestId:event.data?.requestId,projectGeneration:event.data?.projectGeneration,geometryRevision:event.data?.geometryRevision,quality:event.data?.quality});actualReceive(event);};
`;
  source+='\n'+prefix;
  return source;
 }
 if(path.endsWith('/country-shared-boundary-packet.js')){
  once('function prepareStrokePacket(segments, maxEdgeDegrees) {',"function prepareStrokePacket(...args){globalThis.__w2Mark?.('stroke-packet','start');try{return rawPrepareStrokePacket(...args);}finally{globalThis.__w2Mark?.('stroke-packet','end');}}function rawPrepareStrokePacket(segments, maxEdgeDegrees) {");return source;
 }
 if(path.endsWith('/viewer-composition.js')){
  once('applyMonth:async(month,{isCurrent,commit})=>{',"applyMonth:async(month,{isCurrent,commit})=>{globalThis.__w2Mark?.('transition','requested',{month});");
  once("onPresented:()=>{commit();}","onPresented:()=>{commit();globalThis.__w2Mark?.('transition','presented',{month});}");
  once("status.dataset.ready='true';","status.dataset.ready='true';globalThis.__w2Mark?.('transition','ready');");return source;
 }
 if(path.endsWith('/core-document-client.js')){
  once('      const { result } = await rpc.request(operation, request, atomic || speculative',"      if(operation==='core.document-replacement-release')globalThis.__w2Mark?.('core-release','start');const { result, timing: __w3Timing } = await rpc.request(operation, request, atomic || speculative");
  once('        ? { timeoutMs: 0 } : { signal: options.signal });',"        ? { timeoutMs: 0 } : { signal: options.signal });if(operation==='core.document-replacement-release')globalThis.__w2Mark?.('core-release','end',{workerMs:__w3Timing?.durationMs??null});");return source;
 }
 if(path.endsWith('/gpu-map-renderer.js')||path.endsWith('/gpu-worker-channels.js')||path.endsWith('/prepared-polygon-mesh.js'))source=priorInstrument(path,source);
 if(path.endsWith('/gpu-map-renderer.js')){
  once("    function syncCountryBoundaryScene() {\n      prepareCountrySharedBoundary({ replace: true, baselineCache: false });\n    }","    function syncCountryBoundaryScene() {\n      prepareCountrySharedBoundary({ replace: true, baselineCache: false });\n    }\n globalThis.__W3_FORCE=()=>{countryBoundaryDependencies=null;prepareCountrySharedBoundary({replace:true});return countryBoundaryRequestId;};");
 }
 return source;
}
