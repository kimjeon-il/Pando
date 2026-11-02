import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Specify evidence directory');
const names=readdirSync(base).filter(n=>/^(A|B|A2)-(cold-\d+|memory)\.json(?:\.gz)?$/.test(n));
const data=[];const hashes=new Map();let consistent=true;
const percentile=(a,p)=>{if(!a.length)return null;a=[...a].sort((x,y)=>x-y);const k=(a.length-1)*p;return a[Math.floor(k)]+(a[Math.ceil(k)]-a[Math.floor(k)])*(k%1);};
const stats=a=>({n:a.length,p50:percentile(a,.5),p90:percentile(a,.9),max:a.length?Math.max(...a):null,mean:a.length?a.reduce((n,v)=>n+v,0)/a.length:null});
for(const name of names){
 const bytes=readFileSync(base+'/'+name);const r=JSON.parse(name.endsWith('.gz')?gunzipSync(bytes):bytes);if(r.status!=='passed'||r.traceError)throw Error('Incomplete '+name);
 const events=JSON.parse(gunzipSync(readFileSync(base+'/'+r.name+'-trace.json.gz')).toString()).traceEvents;
 const marks=events.filter(e=>e.name?.startsWith('W2|')).map(e=>({...JSON.parse(e.name.slice(3)),ts:e.ts,pid:e.pid,tid:e.tid,local:e.args?.data?.startTime})).sort((a,b)=>a.ts-b.ts);
 const spans=[],open=new Map();
 for(const m of marks){const key=[m.pid,m.tid,m.stage,m.requestId,m.projectGeneration,m.quality].join(':');if(m.edge==='start'){const stack=open.get(key)||[];stack.push(m);open.set(key,stack);}if(m.edge==='end'){const a=open.get(key)?.pop();if(a)spans.push({stage:m.stage,start:a.ts,end:m.ts,ms:(m.ts-a.ts)/1000,requestId:m.requestId,generation:m.projectGeneration,quality:m.quality,pid:m.pid,tid:m.tid,workerMs:m.workerMs??null});}}
 const results=marks.filter(m=>m.stage==='result-post'&&m.edge==='start'&&m.type==='prepared');
 const row={name:r.name,kind:r.memory?'memory':'performance',identity:r.identity,status:r.status,errors:r.errors,warnings:r.warnings,checkpoints:r.checkpoints,processesAfterClose:r.processesAfterClose,samples:[],requests:results.map(m=>({id:m.requestId,generation:m.projectGeneration,quality:m.quality,cacheSupported:m.cacheSupported,hit:m.cacheSupported?m.packetCacheHit:null,residentBytes:m.cacheSupported?m.packetCacheResidentEstimate:null,bytes:m.bytes,ts:m.ts,packet:spans.filter(s=>s.stage==='packet'&&s.requestId===m.requestId&&s.generation===m.projectGeneration),preparation:spans.filter(s=>s.stage==='packet-prepare-total'&&s.requestId===m.requestId&&s.generation===m.projectGeneration),strokes:spans.filter(s=>s.stage==='stroke-packet'&&s.requestId===m.requestId&&s.generation===m.projectGeneration)})),stages:spans};
 for(const s of r.samples){
  if(hashes.has(s.target)&&hashes.get(s.target)!==s.semantic.hash)consistent=false;hashes.set(s.target,s.semantic.hash);
  const start=marks.find(m=>m.stage==='transition'&&m.edge==='requested'&&Math.abs(m.local-s.requested)<2);if(!start)throw Error('Clock alignment '+name);
  const presented=marks.find(m=>m.stage==='transition'&&m.edge==='presented'&&m.ts>=start.ts);const ready=marks.find(m=>m.stage==='transition'&&m.edge==='ready'&&m.ts>=start.ts);if(!presented||!ready)throw Error('Incomplete transition');
  const generation=marks.filter(m=>m.stage==='gate'&&m.ts>=start.ts&&m.ts<=presented.ts).at(-1)?.generation;
  const pending=marks.filter(m=>m.stage==='pending'&&m.edge==='start'&&m.projectGeneration===generation&&m.ts>=start.ts&&m.ts<=presented.ts);
  const accepted=row.requests.filter(m=>pending.some(p=>p.requestId===m.id&&p.projectGeneration===m.generation));
  const release=spans.filter(p=>p.stage==='core-release'&&p.start>=start.ts&&p.start<=ready.ts);
  const samplespans=spans.filter(p=>p.end>start.ts&&p.start<presented.ts).map(p=>({...p,relativeStartMs:(p.start-start.ts)/1000,relativeEndMs:(p.end-start.ts)/1000,overlapMs:Math.max(0,Math.min(p.end,presented.ts)-Math.max(p.start,start.ts))/1000}));
  row.samples.push({index:s.index,target:s.target,display:s.displayMs,ready:s.readyMs,hash:s.semantic.hash,labels:s.semantic.labels.length,longTask:Math.max(0,...s.longTasks.map(t=>t.ms)),acceptedWorker:accepted.length,acceptedRequests:accepted,workerCacheHits:accepted.filter(m=>m.hit===true).length,workerCacheMisses:accepted.filter(m=>m.hit===false).length,mainRendererReuse:pending.length===0,release,samplespans});
 }
 data.push(row);console.log('W3_ANALYZED '+r.name);
}
const conditions={};for(const label of ['A','B','A2']){
 const runs=data.filter(r=>r.name.startsWith(label+'-')&&!r.name.includes('memory')),first=runs.map(r=>r.samples[0]);const warm=runs.flatMap(r=>r.samples.slice(2));const requests=runs.flatMap(r=>r.requests).filter(r=>r.bytes>0);
 const memory=data.find(r=>r.name===label+'-memory');
 conditions[label]={coldRuns:runs.length,firstDisplay:stats(first.map(s=>s.display)),firstReady:stats(first.map(s=>s.ready)),over2500:first.filter(s=>s.display>2500).length,over2500Rate:first.length?first.filter(s=>s.display>2500).length/first.length:null,warmDisplay:stats(warm.map(s=>s.display)),warmReady:stats(warm.map(s=>s.ready)),packetCalculation:stats(requests.flatMap(r=>r.packet.map(p=>p.ms))),packetPreparation:stats(requests.flatMap(r=>r.preparation.map(p=>p.ms))),firstPacketPreparation:stats(first.flatMap(s=>s.acceptedRequests.flatMap(r=>r.preparation.map(p=>p.ms)))),hitPreparation:label==='B'?stats(requests.filter(r=>r.hit===true).flatMap(r=>r.preparation.map(p=>p.ms))):null,missPreparation:label==='B'?stats(requests.filter(r=>r.hit===false).flatMap(r=>r.preparation.map(p=>p.ms))):null,cacheSupported:label==='B',cacheHits:label==='B'?requests.filter(r=>r.hit===true).length:null,cacheMisses:label==='B'?requests.filter(r=>r.hit===false).length:null,firstTransitionsWithWorkerHit:label==='B'?first.filter(s=>s.workerCacheHits>0).length:null,firstTransitionsWithoutWorker:runs.length?first.filter(s=>s.mainRendererReuse).length:0,calculationCount:runs.reduce((n,r)=>n+r.stages.filter(s=>s.stage==='packet').length,0),memoryCheckpoints:memory?.checkpoints,memorySamples:memory?.samples.length??0};
}
const improve=(a,b)=>Number.isFinite(a)&&a>0?(a-b)/a*100:null;
const improvements={vsA:{firstP50Percent:improve(conditions.A.firstDisplay.p50,conditions.B.firstDisplay.p50),firstP90Percent:improve(conditions.A.firstDisplay.p90,conditions.B.firstDisplay.p90)},vsA2:{firstP50Percent:improve(conditions.A2.firstDisplay.p50,conditions.B.firstDisplay.p50),firstP90Percent:improve(conditions.A2.firstDisplay.p90,conditions.B.firstDisplay.p90)}};
const complete=consistent&&['A','B','A2'].every(k=>conditions[k].coldRuns===10&&conditions[k].warmDisplay.n>=20&&conditions[k].memorySamples>=60)&&data.every(r=>r.errors.length===0&&r.processesAfterClose.length===0);
writeFileSync(base+'/analysis.json.gz',gzipSync(JSON.stringify({consistent,hashes:Object.fromEntries(hashes),complete,conditions,improvements,runs:data},null,2)));
console.log('W3_SUMMARY '+JSON.stringify({consistent,complete,conditions:Object.fromEntries(Object.entries(conditions).map(([k,v])=>[k,{...v,memoryCheckpoints:undefined}])),improvements}));
