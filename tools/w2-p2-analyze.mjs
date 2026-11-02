import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const base=process.env.PANDOLAB_W2_EVIDENCE||process.argv[2];if(!base)throw Error('Evidence directory required');
const names=readdirSync(base).filter(n=>/^(A-\d|A2-\d|B|minimal-\d|thin-\d|safety(?:-exact)?|main-exact-delay|worker-\d-(normal|delay|restore)|main-\d-(normal|delay|restore))\.json$/.test(n));
const output=[];
const overlap=(a,b,c,d)=>Math.max(0,Math.min(b,d)-Math.max(a,c));
for(const name of names){
 const row=JSON.parse(readFileSync(base+'/'+name));
 const summary={name:row.name,status:row.status,identity:row.identity,errors:row.errors,warnings:row.warnings,samples:[],memory:{start:row.memoryStart,end:row.memoryEnd},workerCounts:[row.targetsStart?.filter(t=>t.type==='worker').length,row.targetsEnd?.filter(t=>t.type==='worker').length]};
 if(row.plain){summary.samples=row.samples.map(s=>({target:s.target,display:s.presented-s.requested,ready:s.ready-s.requested,hash:s.semanticHash}));output.push(summary);continue;}
 const trace=JSON.parse(gunzipSync(readFileSync(base+'/'+row.name+'-trace.json.gz')).toString()).traceEvents;
 const marks=trace.filter(e=>e.name?.startsWith('W2|')).map(e=>({...JSON.parse(e.name.slice(3)),ts:e.ts,pid:e.pid,tid:e.tid})).sort((a,b)=>a.ts-b.ts);
 const profiles=new Map();
 for(const e of trace)if(e.name==='Profile')profiles.set(e.pid+':'+e.id,{time:e.args.data.startTime,nodes:new Map(),samples:[]});
 for(const e of trace.filter(e=>e.name==='ProfileChunk').sort((a,b)=>a.ts-b.ts)){
  const p=profiles.get(e.pid+':'+e.id);if(!p)continue;const d=e.args.data;
  for(const n of d.cpuProfile?.nodes||[])p.nodes.set(n.id,n);
  for(const [i,id]of (d.cpuProfile?.samples||[]).entries()){const delta=d.timeDeltas?.[i]||0;p.time+=delta;p.samples.push({ts:p.time,id,delta});}
 }
 const spans=[],open=new Map();
 for(const m of marks){const key=[m.pid,m.tid,m.requestId,m.stage].join(':');if(m.edge==='start'){const list=open.get(key)||[];list.push(m);open.set(key,list);}if(m.edge==='end'){const start=open.get(key)?.pop();if(start)spans.push({stage:m.stage,requestId:m.requestId,generation:m.projectGeneration,start:start.ts,end:m.ts,ms:(m.ts-start.ts)/1000,pid:m.pid,tid:m.tid,detail:{...start,...m}});}}
 summary.stages=spans.filter(s=>!s.stage.startsWith('digest-')||s.stage==='digest-all').map(s=>({...s,quality:s.detail.quality??null,detail:{cacheHit:s.detail.cacheHit,stats:s.detail.stats,bytes:s.detail.bytes,featureCount:s.detail.featureCount,ready:s.detail.ready}}));
 summary.yields=marks.filter(m=>m.stage==='yield'&&m.edge==='scheduled').map(m=>{const callback=marks.find(n=>n.pid===m.pid&&n.tid===m.tid&&n.stage==='yield'&&n.edge==='callback'&&n.yieldId===m.yieldId);const resumed=marks.find(n=>n.pid===m.pid&&n.tid===m.tid&&n.stage==='yield'&&n.edge==='resumed'&&n.yieldId===m.yieldId);return{requestId:m.requestId,generation:m.projectGeneration,yieldId:m.yieldId,timerWaitMs:callback?(callback.ts-m.ts)/1000:null,continuationWaitMs:resumed&&callback?(resumed.ts-callback.ts)/1000:null};});
 for(const s of row.samples){
  const request=marks.find(m=>m.stage==='transition'&&m.edge==='requested'&&Math.abs((trace.find(e=>e.ts===m.ts&&e.name?.startsWith('W2|'))?.args?.data?.startTime||0)-s.requested)<2);
  if(!request)throw Error('Cannot align '+row.name+' '+s.target);
  const presented=marks.find(m=>m.stage==='transition'&&m.edge==='presented'&&m.ts>=request.ts),end=presented.ts;
  const intersecting=spans.filter(p=>p.end>request.ts&&p.start<end).map(p=>({stage:p.stage,requestId:p.requestId,generation:p.generation,startMs:(p.start-request.ts)/1000,endMs:(p.end-request.ts)/1000,totalMs:p.ms,overlapMs:overlap(p.start,p.end,request.ts,end)/1000,tid:p.tid}));
  const boundaryThreads=new Set(marks.filter(m=>m.stage==='dequeue').map(m=>m.tid));
  const timers=trace.filter(e=>e.name==='TimerFire'&&boundaryThreads.has(e.tid)&&e.ts+e.dur>request.ts&&e.ts<end).sort((a,b)=>overlap(b.ts,b.ts+b.dur,request.ts,end)-overlap(a.ts,a.ts+a.dur,request.ts,end));
  const timer=timers[0];const top=new Map();
  if(timer)for(const p of profiles.values())for(const sample of p.samples){if(sample.ts<Math.max(timer.ts,request.ts)||sample.ts>Math.min(timer.ts+timer.dur,end))continue;let node=p.nodes.get(sample.id),stack=[];while(node&&stack.length<100){stack.push(node.callFrame);node=p.nodes.get(node.parent);}if(!stack.some(f=>/country-shared-boundary|boundary-topology|prepared-boundary/.test(f.url||'')))continue;const leaf=stack[0];const key=JSON.stringify(leaf);top.set(key,(top.get(key)||0)+sample.delta/1000);}
  const transitions=marks.filter(m=>m.ts>=request.ts&&m.ts<=end&&['gate','readiness-sample','boundary-published','canonical-ready','control-delay','main-control'].includes(m.stage)).map(m=>({...m,relativeMs:(m.ts-request.ts)/1000}));
  const packetSpan=spans.find(p=>p.stage==='packet'&&p.start>=request.ts&&p.end<=end),packetCpu=new Map();
  const packetTimer=packetSpan?timers.find(t=>t.tid===packetSpan.tid&&t.ts<=packetSpan.start&&t.ts+t.dur>=packetSpan.end):null;
  if(packetSpan)for(const p of profiles.values())for(const sample of p.samples){if(sample.ts<packetSpan.start||sample.ts>packetSpan.end)continue;let node=p.nodes.get(sample.id),stack=[];while(node&&stack.length<100){stack.push(node.callFrame);node=p.nodes.get(node.parent);}if(!stack.some(f=>/country-shared-boundary-packet/.test(f.url||'')))continue;const label=stack.filter(f=>/prepareStrokePacket|boundaryAssembleStrokePacket|buildGpuStrokeInstances|flushOutlines|prepareCountrySharedBoundaryPacket/.test(f.functionName||'')).map(f=>f.functionName).join(' <- ');const key=label+' | '+(stack[0]?.functionName||'anonymous');packetCpu.set(key,(packetCpu.get(key)||0)+sample.delta/1000);}
  summary.samples.push({target:s.target,display:s.presented-s.requested,ready:s.ready-s.requested,hash:s.semanticHash,longTask:Math.max(0,...s.longTasks.map(t=>t.ms)),intersecting,timer:timer?{startMs:(timer.ts-request.ts)/1000,ms:timer.dur/1000,overlapMs:overlap(timer.ts,timer.ts+timer.dur,request.ts,end)/1000}:null,packetTimer:packetTimer?{startMs:(packetTimer.ts-request.ts)/1000,ms:packetTimer.dur/1000}:null,timerCpuSamples:[...top].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([frame,ms])=>({frame:JSON.parse(frame),sampledMs:ms})),packetCpuSamples:[...packetCpu].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([stack,sampledMs])=>({stack,sampledMs})),transitions});
 }
 output.push(summary);console.log(JSON.stringify({name:row.name,first:summary.samples[0]?.display,hash:summary.samples[0]?.hash}));
}
const hashes=new Map();let consistent=true;for(const row of output)for(const s of row.samples){if(hashes.has(s.target)&&hashes.get(s.target)!==s.hash)consistent=false;hashes.set(s.target,s.hash);}
writeFileSync(base+'/stage-analysis.json',JSON.stringify({consistent,hashes:Object.fromEntries(hashes),runs:output},null,2));console.log('W2_ANALYSIS '+JSON.stringify({runs:output.length,consistent}));
