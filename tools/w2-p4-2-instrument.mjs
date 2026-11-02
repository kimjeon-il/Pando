import {instrument as w3Instrument} from './w2-p3-instrument.mjs';

// Applied to diagnostic snapshots only; the tracked product source is untouched.
export function instrument(path, original, {stepBytes = 256 * 1024, early = true} = {}) {
  if (![256 * 1024, 1024 * 1024].includes(stepBytes)) throw Error('Unsupported diagnostic step budget');
  let source = w3Instrument(path, original);
  const once = (before, after) => {
    if (source.split(before).length !== 2) throw Error(`W2-P4-2 anchor mismatch: ${path}: ${before}`);
    source = source.replace(before, after);
  };
  if (path.endsWith('/country-shared-boundary-worker.js')) {
    once("self.onmessage=event=>{__w2Mark('worker-receive','instant',{requestId:event.data?.requestId,projectGeneration:event.data?.projectGeneration,geometryRevision:event.data?.geometryRevision,quality:event.data?.quality});actualReceive(event);};",
      "let __w4Receive=0;self.onmessage=event=>{const seq=++__w4Receive;performance.mark('W4|'+JSON.stringify({stage:'worker-before-data',seq}));const data=event.data;performance.mark('W4|'+JSON.stringify({stage:'worker-after-data',seq,requestId:data?.requestId,projectGeneration:data?.projectGeneration,geometryRevision:data?.geometryRevision,quality:data?.quality}));__w2Mark('worker-receive','instant',{requestId:data?.requestId,projectGeneration:data?.projectGeneration,geometryRevision:data?.geometryRevision,quality:data?.quality});actualReceive(event);};");
  }
  if (path.endsWith('/gpu-upload-scheduler.js')) {
    once('    if (isInputPending()) { lastInput = now(); schedule(); return; }',
      "    if (isInputPending()) { performance.mark('W4|'+JSON.stringify({stage:'input-pending'}));lastInput = now(); schedule(); return; }");
    once('const result = job.step({ byteBudget: Math.min(bytes, 256 * 1024), deadline: start + 2 }) || {};',
      `const __w4Start=performance.now(),__w4Budget=Math.min(bytes, ${stepBytes});const result = job.step({ byteBudget: __w4Budget, deadline: start + 2 }) || {};performance.mark('W4|'+JSON.stringify({stage:'upload-step',key:job.key,priority:job.priority,projectGeneration:job.projectGeneration,byteBudget:__w4Budget,used:Number(result.bytes)||0,interaction,elapsed:performance.now()-__w4Start,done:!!result.done}));`);
  }
  if (path.endsWith('/gpu-stroke-renderer.js')) {
    once('            gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.STATIC_DRAW);',
      "            {const t=performance.now();gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.STATIC_DRAW);performance.mark('W4|'+JSON.stringify({stage:'buffer-data',key,part:job.part,bytes:data.byteLength,elapsed:performance.now()-t}));}");
    once('          gl.bufferSubData(gl.ARRAY_BUFFER, job.offset, new Uint8Array(data.buffer, data.byteOffset + job.offset, bytes));',
      "          {const t=performance.now();gl.bufferSubData(gl.ARRAY_BUFFER, job.offset, new Uint8Array(data.buffer, data.byteOffset + job.offset, bytes));performance.mark('W4|'+JSON.stringify({stage:'buffer-sub-data',key,part:job.part,offset:job.offset,bytes,elapsed:performance.now()-t}));}");
    once('          onResourceReady?.(key);',"          performance.mark('W4|'+JSON.stringify({stage:'resource-ready',key,instances:g.instances.byteLength,nodes:g.nodes.byteLength}));onResourceReady?.(key);");
  }
  if (path.endsWith('/gpu-worker-channels.js')) {
    once('    worker.onmessage = event => {',
      "    let __w4Receive=0;worker.onmessage = event => {if(live&&!disposed&&String(url).includes('country-shared-boundary')){const seq=++__w4Receive;performance.mark('W4|'+JSON.stringify({stage:'main-before-data',seq}));const data=event.data;performance.mark('W4|'+JSON.stringify({stage:'main-after-data',seq,requestId:data?.requestId,projectGeneration:data?.projectGeneration,geometryRevision:data?.geometryRevision,quality:data?.quality}));}");
  }
  if (early && path.endsWith('/viewer-map.js')) {
    const helper="const __w4Time=async(stage,fn)=>{const spanId=globalThis.__w4SpanId=(globalThis.__w4SpanId||0)+1;const requestId=globalThis.__w4TransitionId??null;const generation=globalThis.__w2Readiness?.().generation??null;performance.mark('W4|'+JSON.stringify({stage,edge:'start',spanId,requestId,generation}));try{return await fn();}finally{performance.mark('W4|'+JSON.stringify({stage,edge:'end',spanId,requestId,generation}));}};\n";
    once('        builtinSession.prepareProjectCandidate(month,{...options,setup}),',"        __w4Time('candidate-prepare',()=>builtinSession.prepareProjectCandidate(month,{...options,setup})),");
    once('        physicalResources.preparePhysicalContext(month,options),',"        __w4Time('physical-prepare',()=>physicalResources.preparePhysicalContext(month,options)),");
    source=helper+source;
  }
  if (early && path.endsWith('/project-domain.js')) {
    const helper="const __w4Time=async(stage,fn)=>{const spanId=globalThis.__w4SpanId=(globalThis.__w4SpanId||0)+1;const requestId=globalThis.__w4TransitionId??null;const generation=globalThis.__w2Readiness?.().generation??null;performance.mark('W4|'+JSON.stringify({stage,edge:'start',spanId,requestId,generation}));try{return await fn();}finally{performance.mark('W4|'+JSON.stringify({stage,edge:'end',spanId,requestId,generation}));}};\n";
    once('source=await commandOwner.temporalSourcePrepare(facts,{dataRevision,manifestSha256,isCurrent:current});',"source=await __w4Time('core-source',()=>commandOwner.temporalSourcePrepare(facts,{dataRevision,manifestSha256,isCurrent:current}));");
    once('const candidate=await commandOwner.temporalCandidatePrepare({',"const candidate=await __w4Time('core-candidate',()=>commandOwner.temporalCandidatePrepare({");
    once('        },{isCurrent:current});',"        },{isCurrent:current}));");
    once('        await commandOwner.temporalCandidateAdopt({',"        await __w4Time('core-adopt',()=>commandOwner.temporalCandidateAdopt({");
    once('          expectedEpoch:prepared.expectedEpoch,\n        });',"          expectedEpoch:prepared.expectedEpoch,\n        }));");
    once("const operation=commandQueue.then(() => replaceAccepted(prepared,reason,options));","const operation=commandQueue.then(() => __w4Time('replace-accepted',()=>replaceAccepted(prepared,reason,options)));");
    once("const nextGeneration = await bumpGeneration(`project-${reason}`, presentation === 'temporal' ? {presentation,isCurrent,onPresented} : null);","const nextGeneration = await __w4Time('generation',()=>bumpGeneration(`project-${reason}`, presentation === 'temporal' ? {presentation,isCurrent,onPresented} : null));");
    once('const outcome = await commandOwner.presentationCatalogLoad(readPresentationCatalog());',"const outcome = await __w4Time('presentation-catalog',()=>commandOwner.presentationCatalogLoad(readPresentationCatalog()));");
    source=helper+source;
  }
  if (early && path.endsWith('/viewer-composition.js')) {
    once("globalThis.__w2Mark?.('transition','requested',{month});","globalThis.__w4TransitionId=(globalThis.__w4TransitionId||0)+1;performance.mark('W4|'+JSON.stringify({stage:'transition-request',requestId:globalThis.__w4TransitionId,month}));globalThis.__w2Mark?.('transition','requested',{month});");
  }
  if (early && path.endsWith('/builtin-session.js')) {
    once('    let record=cachedBytesFor(month,identity,{background});',"    let record=cachedBytesFor(month,identity,{background});performance.mark('W4|'+JSON.stringify({stage:'source-cache',month,hit:!!record,generation:expectedGeneration,requestId:globalThis.__w4TransitionId??null,background}));");
    once('      const {project}=await builtinWorldLoader.loadProject(month,{isCurrent,',"      performance.mark('W4|'+JSON.stringify({stage:'country-io',edge:'start',month}));const {project}=await builtinWorldLoader.loadProject(month,{isCurrent,");
    once('        concurrency:background?1:6,waitForIdle:background?waitForIdle:null});',"        concurrency:background?1:6,waitForIdle:background?waitForIdle:null});performance.mark('W4|'+JSON.stringify({stage:'country-io',edge:'end',month}));");
  }
  return source;
}
