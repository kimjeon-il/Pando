import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';

const root=resolve(process.argv[2]||'.w2-library/reports/development/performance/w1-windows-gpu-2026-11-02/measurement');
const dest=resolve(process.argv[3]||'test-results/w2-retrospective');
const load=name=>readFileSync(join(root,name));
const analysis=JSON.parse(load('analysis.json'));
const report=JSON.parse(load('report-win32.json'));
const round=n=>Math.round(n*100)/100;
const key=e=>String(e.pid)+':'+String(e.tid);
const finish=e=>e.ts+Number(e.dur||0);
const content=e=>e.args?.data||{};
const url=e=>String(content(e).url||content(e).scriptName||'');
const intersect=(e,a,b)=>Math.max(0,Math.min(finish(e),b)-Math.max(e.ts,a))/1000;
if(!analysis.complete||!report.modes?.every(m=>m.gpu.sourceCommit===analysis.source&&m.gpu.dataRevision===analysis.data))
 throw Error('W1 pins or baseline validation missing');
if(report.modes[0].category!=='hardware-reported')throw Error('W1 lacks verified D3D11 baseline');

function inspect(traceEvents,meta,mode,roundIndex){
 const row=analysis.modes.find(v=>v.mode===mode)?.rows?.[roundIndex];
 if(!row)throw Error('W1 sample absent '+mode+' '+roundIndex);
 const firstTime=analysis.modes.find(v=>v.mode===mode).rows[0].requestedAt;
 const starts=traceEvents.filter(e=>e.name?.startsWith('W1:requested:')&&
   Number.isFinite(content(e).startTime)&&content(e).startTime>=firstTime-1).sort((a,b)=>a.ts-b.ts);
 if(starts.length<=roundIndex)throw Error('Not enough W1 trace start marks: '+mode+' '+starts.length);
 const begin=starts[roundIndex];
 const offset=Math.abs(content(begin).startTime-row.requestedAt);
 if(offset>15)throw Error('Requested marker mismatch: '+mode+' '+offset);
 const pres=traceEvents.find(e=>e.name?.startsWith('W1:presented:')&&e.ts>=begin.ts);
 const ready=traceEvents.find(e=>e.name==='W1:ready:'&&e.ts>=begin.ts);
 const atPres=pres?.ts??(begin.ts+row.requestedToPresentedMs*1000);
 const atReady=ready?.ts??(begin.ts+row.requestedToReadyMs*1000);
 if(!(begin.ts<atPres&&atPres<atReady))throw Error('W1 invalid marker sequence: '+mode);
 if(Math.abs((atReady-begin.ts)/1000-row.requestedToReadyMs)>40)
  throw Error('W1 ready mismatch: '+mode);
 const threads=new Map(meta.filter(e=>e.name==='thread_name').map(e=>[key(e),e.args?.name||'']));
 const first={begin:begin.ts,end:atPres},second={begin:atPres,end:atReady};
 const phases={};
 for(const [label,span] of Object.entries({beforeDisplay:first,afterDisplay:second})){
  const candidates=traceEvents.filter(e=>e.ph==='X'&&Number.isFinite(e.dur)&&e.dur>=5000
    &&finish(e)>span.begin&&e.ts<span.end&&/RendererMain|Worker|Gpu|Compositor/i.test(threads.get(key(e))||''))
   .map(e=>({...e,thread:threads.get(key(e))||'unknown',overlapMs:round(intersect(e,span.begin,span.end)),sourceUrl:url(e)}));
  const top=predicate=>candidates.filter(predicate).sort((a,b)=>b.overlapMs-a.overlapMs).slice(0,16)
   .map(e=>({name:e.name,thread:e.thread,atMs:round((e.ts-begin.ts)/1000),
     endMs:round((finish(e)-begin.ts)/1000),durationMs:round(e.dur/1000),
     overlapMs:e.overlapMs,url:e.sourceUrl||undefined,timerId:content(e).timerId??undefined,
     threadKey:key(e)}));
  const timers=top(e=>e.name==='TimerFire'&&/Worker/.test(e.thread));
  const nested=timers.slice(0,4).map(timer=>{
   const events=candidates.filter(e=>key(e)===timer.threadKey&&e.ts>=begin.ts+timer.atMs*1000-5
     &&finish(e)<=begin.ts+timer.endMs*1000+5 &&e.name!=='TimerFire'
     &&/FunctionCall|HandlePostMessage|GC|RunMicrotasks|Evaluate|Compile|V8|Microtask/i.test(e.name))
    .sort((a,b)=>b.dur-a.dur).slice(0,12);
   return {timer,children:events.map(e=>({name:e.name,atMs:round((e.ts-begin.ts)/1000),
     durationMs:round(e.dur/1000),url:e.sourceUrl||undefined}))};
  });
  phases[label]={durationMs:round((span.end-span.begin)/1000),
   topMain:top(e=>/RendererMain/.test(e.thread)),topWorker:top(e=>/Worker/.test(e.thread)),
   timerFire:timers,nestedTimerEvents:nested,
   countryBoundaryFunctions:top(e=>/country-shared-boundary-worker/i.test(e.sourceUrl)),
   mainWorkerMessages:top(e=>e.name==='HandlePostMessage'&&/RendererMain/.test(e.thread))};
 }
 return {mode,round:roundIndex,target:row.target,kind:row.kind,
  requestToPresentedMs:row.requestedToPresentedMs,requestToReadyMs:row.requestedToReadyMs,
  releaseMs:row.releaseRoundtripMs,maxLongTaskMs:row.longTaskMaxMs,
  maxUpdateLayersMs:row.layerMaxMs,
  traceRequestOffsetMs:round(offset),phases};
}
function inspectMode(mode){
 const raw=load(mode+'-trace.json.gz');
 const doc=JSON.parse(gunzipSync(raw).toString('utf8'));
 if(!Array.isArray(doc.traceEvents)||doc.traceEvents.length<1000)throw Error('Incomplete W1 trace '+mode);
 const events=doc.traceEvents;
 const meta=events.filter(e=>e.ph==='M');
 const first=inspect(events,meta,mode,0),second=inspect(events,meta,mode,1);
 const out={mode,events:events.length,compressedBytes:raw.length,first,second};
 console.log('W2_FIRST_TRACE '+JSON.stringify({mode,events:events.length,
  first:{requestToPresentedMs:first.requestToPresentedMs,requestToReadyMs:first.requestToReadyMs,
   releaseMs:first.releaseMs,maxLongTaskMs:first.maxLongTaskMs,
   timers:first.phases.beforeDisplay.timerFire.slice(0,6),
   boundary:first.phases.beforeDisplay.countryBoundaryFunctions.slice(0,6),
   main:first.phases.beforeDisplay.topMain.slice(0,5)}}).slice(0,16000));
 return out;
}
const modes=[];
for(const mode of ['default','default-retest','swiftshader']){
 modes.push(inspectMode(mode));
 if(typeof globalThis.gc==='function')globalThis.gc();
}
const original=modes.find(m=>m.mode==='default').first;
const exceptional=modes.find(m=>m.mode==='default-retest').first;
const delta={
 preDisplayMs:round(exceptional.requestToPresentedMs-original.requestToPresentedMs),
 postDisplayMs:round((exceptional.requestToReadyMs-exceptional.requestToPresentedMs)
                   -(original.requestToReadyMs-original.requestToPresentedMs)),
 mainLongTaskMs:round(exceptional.maxLongTaskMs-original.maxLongTaskMs),
 releaseMs:round(exceptional.releaseMs-original.releaseMs),
};
const output={schema:'w2-first-windows-trace-audit-v1',
 source:analysis.source,data:analysis.data,baseline:'default warmup round 0',
 outlier:'default-retest warmup round 0',delta,modes,
 caution:['Nested Chrome events cannot be summed.',
  'An overlapping Worker TimerFire is not by itself proof that Viewer waited for the Worker.',
  'Country-boundary Worker and the accepted frame require request-id/dependency tracing for causal attribution.']};
mkdirSync(dest,{recursive:true});
writeFileSync(join(dest,'w2-audit.json'),JSON.stringify(output,null,2)+'\n');
const summary=['# W2 first transition trace audit',
 'Pinned code: '+analysis.source,'Pinned data: '+analysis.data,
 'First accepted transition before-display excess: '+delta.preDisplayMs+' ms',
 'After-display excess: '+delta.postDisplayMs+' ms',
 'Core release RPC delta: '+delta.releaseMs+' ms',
 'Main longest task delta: '+delta.mainLongTaskMs+' ms',
 ...modes.map(m=>'## '+m.mode+'\n'+JSON.stringify({
  first:m.first.phases.beforeDisplay,second:m.second.phases.beforeDisplay
 },null,2)),
 'Note: Workers are concurrent. Time overlap alone does not prove a critical dependency.'];
writeFileSync(join(dest,'w2-audit.md'),summary.join('\n\n')+'\n');
console.log('W2_AUDIT_COMPARISON '+JSON.stringify({delta,source:analysis.source,
 timerOutlier:exceptional.phases.beforeDisplay.timerFire.slice(0,5),
 boundaryOutlier:exceptional.phases.beforeDisplay.countryBoundaryFunctions.slice(0,5)}).slice(0,17000));
