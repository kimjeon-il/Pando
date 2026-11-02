import{instrument as baseInstrument}from'./w2-p5-2-instrument.mjs';
// Diagnostic-only main-thread joining. The current renderer still checks every
// identity field and temporalFrameReady; a mismatch always takes the native path.
export function instrument(path,original){
 let source=baseInstrument(path,original);
 if(path.endsWith('/viewer-composition.js')){
  const current="onPresented:()=>{const state=globalThis.__w2Readiness?.();performance.mark('W5|'+JSON.stringify({stage:'initial-presented',generation:state?.generation??null,requestId:state?.requestId??null,boundaryGeneration:state?.boundaryGeneration??null,boundaryQuality:state?.boundaryQuality??null,quality:state?.quality??null,canonicalMeshReady:state?.canonicalMeshReady??null,pendingBoundary:state?.pendingBoundary??null}));get('viewer').dataset.initialLoading='false';map.finishInitialPreview();}";
  const baseline="onPresented:()=>{performance.mark('W5|'+JSON.stringify({stage:'initial-presented'}));get('viewer').dataset.initialLoading='false';map.finishInitialPreview();}";
  if(source.split(current).length!==2)throw Error('Initial presentation anchor mismatch');source=source.replace(current,baseline);
 }
 if(!path.endsWith('/gpu-worker-channels.js'))return source;
 const once=(a,b)=>{if(source.split(a).length!==2)throw Error('Join anchor mismatch: '+a);source=source.replace(a,b);};
 const helpers=String.raw`
    const __w5Boundary=String(url).includes('country-shared-boundary');
    let __w5Active=null,__w5Pending=null,__w5Bypass=false;
    const __w5Mark=(stage,extra={})=>performance.mark('W5|'+JSON.stringify({stage,...extra}));
    const __w5Native=args=>{const d=args[0];__w5Mark('native-post-start',{requestId:d?.requestId,projectGeneration:d?.projectGeneration});try{worker.postMessage(...args);}finally{__w5Mark('native-post-end',{requestId:d?.requestId,projectGeneration:d?.projectGeneration});}};
    const __w5AsyncNative=args=>{try{__w5Native(args);}catch(error){__w5Mark('native-post-error',{requestId:args[0]?.requestId,message:String(error)});if(onerror)onerror({error,message:String(error)});else queueMicrotask(()=>{throw error;});}};
    function __w5Proof(data){
      const start=performance.now(),snapshot=structuredClone(data),cloned=performance.now();
      const valid=x=>Array.isArray(x)?x.every(valid):typeof x==='number'&&Number.isFinite(x);
      if(!snapshot.features.every(f=>f.geometry==null||(typeof f.geometry.type==='string'&&valid(f.geometry.coordinates))))throw Error('Unsupported boundary geometry');
      const serialized=JSON.stringify([snapshot.quality,snapshot.includeOutlines!==false,snapshot.features]);const bytes=new TextEncoder().encode(serialized),encoded=performance.now();
      __w5Mark('proof-start',{requestId:data.requestId,projectGeneration:data.projectGeneration,bytes:bytes.byteLength,cloneMs:cloned-start,encodeMs:encoded-cloned});
      const promise=crypto.subtle.digest('SHA-256',bytes).then(buffer=>{const sha=[...new Uint8Array(buffer)].map(x=>x.toString(16).padStart(2,'0')).join('');__w5Mark('proof-end',{requestId:data.requestId,projectGeneration:data.projectGeneration,sha,wallMs:performance.now()-start});return sha;},error=>{__w5Mark('proof-error',{requestId:data.requestId,message:String(error)});return null;});
      return{snapshot,promise};
    }
    function __w5Forward(data){__w5Bypass=true;try{worker.onmessage({data});}finally{__w5Bypass=false;}}
    function __w5Flush(p){
      if(!live||disposed||__w5Pending!==p||!p.matched||!p.reply)return;
      __w5Pending=null;__w5Active=null;const old=p.reply,next=p.next.snapshot;
      __w5Forward(old);
      const current=globalThis.__w2Readiness?.();
      if(!current){__w5Mark('join-fallback',{requestId:next.requestId,reason:'no-readiness-certificate'});__w5AsyncNative([next]);return;}
      if(Number(current.requestId)!==Number(next.requestId)||Number(current.generation)!==Number(next.projectGeneration)||Number(current.geometryRevision)!==Number(next.geometryRevision)||current.quality!==next.quality){__w5Mark('join-stale',{requestId:next.requestId,projectGeneration:next.projectGeneration});return;}
      __w5Mark('join-adopt',{requestId:next.requestId,projectGeneration:next.projectGeneration,oldRequestId:old.requestId,oldGeneration:old.projectGeneration});
      __w5Forward({...old,requestId:next.requestId,projectGeneration:next.projectGeneration,geometryRevision:next.geometryRevision,quality:next.quality,__w5Joined:true});
    }
    function __w5Send(args){
      const data=args[0];if(!__w5Boundary){worker.postMessage(...args);return;}if(data?.type!=='replace'||!Array.isArray(data.features)||!data.features.length||args.length!==1){if(data?.type==='replace'||data?.type==='patch'){const p=__w5Pending;__w5Pending=null;__w5Active=null;if(p?.reply)__w5Forward(p.reply);if(p&&Number(data.projectGeneration)===Number(p.next.snapshot.projectGeneration))__w5Native([p.next.snapshot]);}__w5Native(args);return;}
      let proof;try{proof=__w5Proof(data);}catch(error){const old=__w5Pending?.reply;__w5Pending=null;__w5Active=null;if(old)__w5Forward(old);__w5Mark('proof-error',{requestId:data.requestId,message:String(error)});__w5Native(args);return;}
      if(!__w5Active){__w5Active={requestId:data.requestId,generation:data.projectGeneration,...proof};__w5Native([proof.snapshot]);return;}
      if(Number(__w5Active.generation)===Number(data.projectGeneration)||__w5Pending){const prior=__w5Pending;__w5Pending=null;__w5Active=null;if(prior?.reply)__w5Forward(prior.reply);__w5Mark('join-fallback',{requestId:data.requestId,reason:'same-generation-or-superseded'});__w5Native([proof.snapshot]);return;}
      const previous=__w5Active,p={next:proof,reply:null,matched:false};__w5Pending=p;__w5Mark('join-candidate',{requestId:data.requestId,projectGeneration:data.projectGeneration,oldRequestId:previous.requestId,oldGeneration:previous.generation});
      Promise.all([previous.promise,proof.promise]).then(([a,b])=>{if(!live||disposed||__w5Pending!==p)return;if(a&&a===b){p.matched=true;__w5Mark('join-match',{requestId:data.requestId,projectGeneration:data.projectGeneration,sha:a});__w5Flush(p);}else{const old=p.reply;__w5Pending=null;__w5Active=null;if(old)__w5Forward(old);__w5Mark('join-fallback',{requestId:data.requestId,reason:'identity-mismatch'});__w5AsyncNative([proof.snapshot]);}}).catch(error=>{if(!live||disposed||__w5Pending!==p){if(onerror)onerror({error,message:String(error)});else queueMicrotask(()=>{throw error;});return;}const old=p.reply;__w5Pending=null;__w5Active=null;if(old)__w5Forward(old);__w5Mark('join-fallback',{requestId:data.requestId,reason:String(error)});__w5AsyncNative([proof.snapshot]);});
    }
    function __w5Intercept(event){
      if(__w5Bypass||!__w5Boundary||!__w5Active)return false;const data=event.data;
      if(Number(data?.requestId)!==Number(__w5Active.requestId)||Number(data?.projectGeneration)!==Number(__w5Active.generation))return false;
      if(data.type==='error'&&__w5Pending){const p=__w5Pending;__w5Pending=null;__w5Active=null;__w5Mark('join-fallback',{requestId:p.next.snapshot.requestId,reason:'old-worker-error'});__w5Native([p.next.snapshot]);return false;}
      if(data.type!=='prepared')return false;
      if(!__w5Pending){__w5Active=null;return false;}
      const p=__w5Pending;p.reply=data;__w5Mark('join-result-held',{requestId:p.next.snapshot.requestId,oldRequestId:data.requestId});__w5Flush(p);return true;
    }
`;
 once('    let onerror = null;','    let onerror = null;\n'+helpers);
 once("worker.postMessage(...args);__w2Mark('main-post','end'","__w5Send(args);__w2Mark('main-post','end'");
 once('      if (!live || disposed) { event.data?.bitmap?.close?.(); return; }','      if (!live || disposed) { event.data?.bitmap?.close?.(); return; }\n      if(__w5Intercept(event))return;');
 once('    worker.onerror = event => { if (live && !disposed) onerror?.(event); };','    worker.onerror = event => { __w5Pending=null;__w5Active=null;if (live && !disposed) onerror?.(event); };');
 return source;
}
