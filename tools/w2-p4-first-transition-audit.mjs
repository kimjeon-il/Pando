import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';

const root=resolve(process.argv[2]||'.w2-p4-library/reports/development/performance/w2-p3-windows-gpu-final-2026-11-02');
const output=resolve(process.argv[3]||'test-results/w2-p4-1');
const json=name=>{const file=join(root,name);const present=existsSync(file)?file:file+'.gz';const bytes=readFileSync(present);return JSON.parse(present.endsWith('.gz')?gunzipSync(bytes).toString('utf8'):bytes.toString('utf8'));};
const first=json('first-transition-timelines.json');
const round=(x,n=1)=>Number.isFinite(x)?Number(x.toFixed(n)):null;
const percentile=(values,p)=>{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b);
 const index=(sorted.length-1)*p,lo=Math.floor(index),hi=Math.ceil(index);
 return sorted[lo]+(sorted[hi]-sorted[lo])*(index-lo);
};
const summarize=(items,field)=>{
 const values=items.map(r=>r[field]).filter(Number.isFinite);
 return {n:values.length,p50:round(percentile(values,.5)),min:round(Math.min(...values)),
  p90:round(percentile(values,.9)),max:round(Math.max(...values))};
};
const stage=(r,n)=>r.stages.find(x=>x.stage===n);
const point=(r,n)=>r.points.find(x=>x.stage===n);
const rows=first.filter(r=>/^B-cold-/.test(r.run)&&stage(r,'main-post')).map(r=>{
 const post=stage(r,'main-post'),send=stage(r,'result-post'),receive=stage(r,'main-receive'),
  packet=stage(r,'packet-prepare-total'),worker=point(r,'worker-receive'),publish=point(r,'boundary-published');
 if(!post||!send||!receive||!packet||!worker||!publish)throw Error('W2-P4 incomplete B cold row '+r.run);
 const firstUpload=r.stages.find(s=>s.stage==='stroke-upload'&&s.startMs>receive.startMs);
 return {
  run:r.run,requestToPresent:r.displayMs,requestToReady:r.readyMs,
  requestToPost:post.startMs,postMessageCall:post.durationMs,
  postReturnToWorkerReceive:worker.atMs-post.endMs,
  workerReceiveToPacket:packet.startMs-worker.atMs,
  packetPrepare:packet.durationMs,
  packetEndToResultPost:send.startMs-packet.endMs,
  resultPostCall:send.durationMs,
  resultPostReturnToMainReceive:receive.startMs-send.endMs,
  mainReceiveCallback:receive.durationMs,
  receiveToPublish:publish.atMs-receive.startMs,
  callbackEndToPublish:publish.atMs-receive.endMs,
  firstStrokeAttemptToPublish:firstUpload?publish.atMs-firstUpload.endMs:null,
  publishToPresent:r.displayMs-publish.atMs,
  firstRejectedGate:r.gates.find(g=>g.boundaries===false)?.atMs??null,
  firstAcceptedGate:r.gates.find(g=>g.boundaries===true)?.atMs??null,
  postStart:post.startMs,postEnd:post.endMs,workerReceive:worker.atMs,
  packetStart:packet.startMs,packetEnd:packet.endMs,
  resultPostStart:send.startMs,resultPostEnd:send.endMs,
  receiveStart:receive.startMs,receiveEnd:receive.endMs,published:publish.atMs,
 };
});
if(rows.length!==8)throw Error('Expected eight natural B first transitions with actual Worker cache hits, found '+rows.length);
const fields=['requestToPresent','requestToPost','postMessageCall','postReturnToWorkerReceive',
 'workerReceiveToPacket','packetPrepare','packetEndToResultPost','resultPostCall',
 'resultPostReturnToMainReceive','mainReceiveCallback','receiveToPublish',
 'callbackEndToPublish','firstStrokeAttemptToPublish','publishToPresent',
 'firstRejectedGate','firstAcceptedGate'];
const distributions=Object.fromEntries(fields.map(f=>[f,summarize(rows,f)]));
const allowed=[
 {run:'B-cold-0',kind:'main renderer reuse / no next-generation Worker request'},
 {run:'B-cold-1',kind:'B cache hit'},
 {run:'B-cold-3',kind:'B cache hit'},
 {run:'B-cold-9',kind:'B cache hit'},
 {run:'A-cold-1',kind:'A full packet calculation'}
];
const traceResults=[];
const nameOf=e=>String(e?.args?.data?.url||e?.args?.data?.scriptName||e?.args?.data?.functionName||e?.args?.beginData?.url||'');
const idOf=e=>e.pid+':'+e.tid;
const finish=e=>e.ts+Number(e.dur||0);
const clip=(e,a,b)=>Math.max(0,Math.min(finish(e),b)-Math.max(e.ts,a))/1000;
for(const entry of allowed){
 const fname=join(root,entry.run+'-trace.json.gz');
 const trace=JSON.parse(gunzipSync(readFileSync(fname)).toString('utf8'));
 const events=trace.traceEvents;
 if(!Array.isArray(events)||events.length<1500)throw Error('Missing Chromium trace: '+entry.run);
 const source=json(entry.run+'.json');
 const sample=source.samples[0];
 const userMarks=events.filter(e=>e.name?.startsWith('W2|')).map(e=>{
  try{return {...JSON.parse(e.name.slice(3)),ts:e.ts,local:e.args?.data?.startTime,thread:idOf(e)};}
  catch{return null;}
 }).filter(Boolean);
 const requested=userMarks.find(e=>e.stage==='transition'&&e.edge==='requested'&&Math.abs(e.local-sample.requested)<3);
 if(!requested)throw Error('Mismatched W2 transition clock for '+entry.run);
 const origin=requested.ts;
 const timeline=first.find(r=>r.run===entry.run);
 if(!timeline||Math.abs((sample.presented-sample.requested)-timeline.displayMs)>3)
  throw Error('Pinned raw sample/summary mismatch: '+entry.run);
 const threads=new Map(events.filter(e=>e.ph==='M'&&e.name==='thread_name')
  .map(e=>[idOf(e),e.args?.name||'']));
 const before=timeline.stages.find(s=>s.stage==='main-post');
 const mainReceived=timeline.stages.find(s=>s.stage==='main-receive');
 const boundary=timeline.points.find(s=>s.stage==='boundary-published');
 const phases={};
 const windows=[['preWorkerPost',0,before?.startMs??timeline.displayMs],
  ['workerPostCall',before?.startMs??0,before?.endMs??0],
  ['afterWorkerPost',before?.endMs??0,mainReceived?.startMs??timeline.displayMs],
  ['gpuResourceWait',mainReceived?.startMs??0,boundary?.atMs??0],
  ['finalFrame',boundary?.atMs??0,timeline.displayMs]];
 for(const [label,startMs,endMs] of windows){
  if(endMs<=startMs)continue;
  const begin=origin+startMs*1000,end=origin+endMs*1000;
  const spans=events.filter(e=>e.ph==='X'&&Number.isFinite(e.dur)
    &&e.dur>=3000 &&e.ts<end && finish(e)>begin)
   .map(e=>({...e,threadName:threads.get(idOf(e))||'',overlap:clip(e,begin,end)}))
   .filter(e=>/(Main|Worker|Gpu|Compositor)/i.test(e.threadName)&&e.overlap>=3);
  const details=list=>list.sort((a,b)=>b.overlap-a.overlap).slice(0,18).map(e=>({
    name:e.name,thread:e.threadName,startMs:round((e.ts-origin)/1000),
    endMs:round((finish(e)-origin)/1000),durationMs:round(e.dur/1000),
    overlapMs:round(e.overlap),url:nameOf(e).slice(0,230)
  }));
  const main=spans.filter(e=>/CrRendererMain|RendererMain/i.test(e.threadName));
  const workers=spans.filter(e=>/DedicatedWorker|Worker thread/i.test(e.threadName));
  const functions=main.filter(e=>e.name==='FunctionCall'||/FireAnimationFrame|EventDispatch/.test(e.name));
  const explicitUpload=main.filter(e=>/gpu-upload-scheduler|gpu-stroke-renderer/i.test(nameOf(e)));
  phases[label]={
    startMs:round(startMs),endMs:round(endMs),durationMs:round(endMs-startMs),
    mainTop:details(main),workerTop:details(workers),mainFunctions:details(functions),
    uploadSchedulerCalls:details(explicitUpload),
    frames:main.filter(e=>e.name==='FireAnimationFrame').length,
    mainRunTasks:main.filter(e=>e.name==='RunTask').length
  };
 }
 const markers=userMarks.filter(e=>e.ts>=origin-1000*1000&&e.ts<origin+sample.displayMs*1000+500*1000
  && ['result-post','main-post','worker-receive','packet-prepare-total','gate','boundary-published'].includes(e.stage));
 const resultPost=markers.find(e=>e.stage==='result-post'&&e.edge==='start'&&e.projectGeneration===2);
 traceResults.push({run:entry.run,kind:entry.kind,traceEvents:events.length,
  mainTraceIdentity:{requested:requested.local,traceOriginUs:origin,source:source.expected,browserVersion:source.browserVersion},
  workerResult:{bytes:resultPost?.bytes??null,cacheHit:resultPost?.packetCacheHit??null,
   requestId:resultPost?.requestId??null,generation:resultPost?.projectGeneration??null},
  phases});
 console.log('W2P4_TRACE '+JSON.stringify({
  run:entry.run,events:events.length,workerResult:traceResults.at(-1).workerResult,
  preTop:phases.preWorkerPost?.mainTop?.slice(0,8),
  gpuTop:phases.gpuResourceWait?.mainTop?.slice(0,8),
  gpuUpload:phases.gpuResourceWait?.uploadSchedulerCalls?.slice(0,6),
  gpuFrames:phases.gpuResourceWait?.frames
 }).slice(0,15000));
}
const record={
 schema:'pando-w2-p4-first-transition-audit-v1',
 sourceBefore:'7c1c55e2a47b03177104bd4a54452692a80674b1',
 sourceAfter:'fe8282ba32761ab9586348d1712e11cc1f4e7882',
 dataRevision:'data-f50b7f480c812df6f5ea0c40f5461ab0',
 sourceArchive:'84d68e4e462457fd0e3d7c86a2088aa081b9b562',
 traceRole:'retrospective of Windows GTX 1650 ANGLE D3D11 measurements; no new GPU measurement',
 scope:'first accepted switch 2026-11 to 2025-12 with actual generation 2 Worker packet and cache hit',
 fixedSamples:rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==='number'?round(v,3):v]))),
 distributions,traceResults,
 interpretationRules:[
  'requestToPost is an elapsed wall-clock interval, not a single function CPU measurement.',
  'postMessageCall is synchronous API wall duration, not a measurement of transport and receive time.',
  'postReturnToWorkerReceive includes scheduling and browser cloning/delivery; no exact sub-attribution.',
  'receiveToPublish is multi-frame wall latency; GPU compute time is NOT equal to the JS ensureResource duration.',
  'Frame trace events are nested and are not summed as exclusive CPU.',
  'Two fast first transitions reusing certified renderer resources are not mixed into eight Worker cache-hit samples.',
  'No byte-count inference is valid without the actual packet geometry upload footprint.'
 ]};
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'phase-audit.json'),JSON.stringify(record,null,2)+'\n');
const summ=Object.fromEntries(Object.entries(distributions).map(([k,v])=>[k,v.p50]));
writeFileSync(join(output,'phase-summary.json'),JSON.stringify({
 source:record.sourceAfter,data:record.dataRevision,n:rows.length,mediansMs:summ,
 traceCases:traceResults.map(({run,workerResult,phases})=>({
  run,workerResult,preTop:phases.preWorkerPost?.mainTop?.slice(0,7),
  gpuTop:phases.gpuResourceWait?.mainTop?.slice(0,7),
  upload:phases.gpuResourceWait?.uploadSchedulerCalls?.slice(0,7),
  frameCount:phases.gpuResourceWait?.frames
 }))
},null,2)+'\n');
console.log('W2P4_SUMMARY '+JSON.stringify({n:rows.length,medianMs:summ,
 traceCases:traceResults.map(t=>({run:t.run,gpuFrames:t.phases.gpuResourceWait?.frames,workerBytes:t.workerResult.bytes,
 uploadCallbacks:t.phases.gpuResourceWait?.uploadSchedulerCalls?.slice(0,3)}))}).slice(0,18000));
