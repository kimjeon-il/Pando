import {replaceExactlyOnce} from './map-transition-baseline.mjs';

// Test-only response instrumentation; no application or C++ files changed.
export function instrumentP5Source(source,name) {
  const mark=(phase,edge)=>`if(!background)globalThis.__PANDO_P0__.mark(${JSON.stringify('p5:'+phase+':'+edge)});`;
  const replace=(oldText,newText)=>{source=replaceExactlyOnce(source,oldText,newText);};
  if(name==='viewer-composition.js'){
    replace('applyMonth:async(month,{isCurrent,commit})=>{',
      'applyMonth:async(month,{isCurrent,commit})=>{globalThis.__PANDO_P0__.begin(month);');
    replace("onPresented:()=>{commit();window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}",
      "onPresented:()=>{commit();globalThis.__PANDO_P0__.presented(month);window.dispatchEvent(new CustomEvent('pandolab:project-changed'));}");
    replace("status.dataset.ready='true';","status.dataset.ready='true';globalThis.__PANDO_P0__.settled();");
    replace('productMode,documentState:',
      'p5CameraSnapshot:()=>structuredClone({projection:map.viewState.projection,view:map.viewState.view}),p5BuildMeta:()=>runtimeContext.meta,productMode,documentState:');
  } else if(name==='builtin-session.js'){
    replace('let record=cachedBytesFor(month,identity,{background});',
      "let record=cachedBytesFor(month,identity,{background});if(!background)globalThis.__PANDO_P0__.mark(record?'p5:cache:hit':'p5:cache:miss');");
    const sourceRead=`const {project}=await builtinWorldLoader.loadProject(month,{isCurrent,
        concurrency:background?1:6,waitForIdle:background?waitForIdle:null});`;
    replace(sourceRead,mark('source-read','start')+sourceRead+mark('source-read','end'));
    const serialize='const bytes=new TextEncoder().encode(JSON.stringify(project));';
    replace(serialize,mark('serialize','start')+serialize+mark('serialize','end'));
    const hash=`const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
        .map(value=>value.toString(16).padStart(2,'0')).join('');`;
    replace(hash,mark('hash','start')+hash+mark('hash','end'));
    const admit='const accepted=await domain.admitStorageBaseline(facts,{expectedGeneration});';
    replace(admit,"globalThis.__PANDO_P0__.mark('p5:baseline-admit:start');"+admit+
      "globalThis.__PANDO_P0__.mark('p5:baseline-admit:end');");
  } else if(name==='project-domain.js'){
    const load='await commandOwner.loadBaseline(prepared.baselineId,prepared.setup);';
    replace(load,"globalThis.__PANDO_P0__.mark('p5:core-load:start');"+load+
      "globalThis.__PANDO_P0__.mark('p5:core-load:end');");
    const restore=`const result = await replaceSnapshot(reason === 'new' ? null : documentModel.snapshot(), {
        reason, generation: nextGeneration, skipRenderReset: true,
        ...(reason === 'new' ? {
          prepared: { ...prepared,project: documentModel.snapshot() },
        } : {}),
      });`;
    replace(restore,"globalThis.__PANDO_P0__.mark('p5:replace-snapshot:start');"+restore+
      "globalThis.__PANDO_P0__.mark('p5:replace-snapshot:end');");
  } else throw new TypeError('Unknown test-only P5 source: '+name);
  return source;
}

export function p5Stages(events) {
  const starts=new Map(),phases={},cache=[];
  for(const row of events){
    if(row.kind==='p5:cache:hit'||row.kind==='p5:cache:miss'){
      cache.push(row.kind.slice(9));continue;
    }
    const match=/^p5:([a-z-]+):(start|end)$/.exec(row.kind);
    if(!match)continue;
    const [,name,edge]=match;
    if(edge==='start')starts.set(name,row.at);
    else if(starts.has(name)){
      const duration=row.at-starts.get(name);
      if(!Number.isFinite(duration)||duration<0)throw new Error('Invalid P5 time: '+name);
      if(Object.hasOwn(phases,name))throw new Error('Overlapping P5 phase: '+name);
      phases[name]=duration;starts.delete(name);
    } else throw new Error('P5 phase ended without start: '+name);
  }
  if(starts.size)throw new Error('P5 phase lacks end: '+[...starts.keys()]);
  return {phases,cache};
}
