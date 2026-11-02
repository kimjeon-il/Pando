import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Missing evidence path');
const read=n=>JSON.parse(readFileSync(base+'/'+n));
const rows=[];
for(const name of readdirSync(base).filter(n=>/^p4-(A|B|A2)-cold-\d+\.json$/.test(n))){
 const r=read(name);if(r.status!=='passed')throw Error('Incomplete '+name);
 const trace=JSON.parse(gunzipSync(readFileSync(base+'/'+r.name+'-trace.json.gz'))).traceEvents;
 const frames=trace.filter(e=>e.name==='FireAnimationFrame'&&e.ph==='X'&&Number.isFinite(e.dur));
 const marks=trace.filter(e=>e.name?.startsWith('W2|')||e.name?.startsWith('W4|')).map(e=>({...JSON.parse(e.name.slice(3)),ts:e.ts,local:e.args?.data?.startTime,pid:e.pid,tid:e.tid})).sort((a,b)=>a.ts-b.ts);
 for(const s of r.samples){
  const start=marks.find(m=>m.stage==='transition'&&m.edge==='requested'&&Math.abs(m.local-s.requested)<2);if(!start)throw Error('Missing transition origin');
  const end=marks.find(m=>m.stage==='transition'&&m.edge==='presented'&&m.ts>=start.ts);if(!end)throw Error('Missing presentation');
  const inWindow=marks.filter(m=>m.ts>=start.ts&&m.ts<=end.ts),gate=inWindow.filter(m=>m.stage==='gate').at(-1),generation=gate?.generation;
  const post=inWindow.find(m=>m.stage==='main-post'&&m.edge==='start'&&m.projectGeneration===generation&&String(m.worker).includes('country-shared-boundary'));
  const worker=inWindow.find(m=>m.stage==='worker-after-data'&&m.projectGeneration===generation),receive=inWindow.find(m=>m.stage==='main-after-data'&&m.projectGeneration===generation);
  const workerBefore=worker&&inWindow.find(m=>m.stage==='worker-before-data'&&m.seq===worker.seq&&m.pid===worker.pid&&m.tid===worker.tid);
  const mainBefore=receive&&inWindow.find(m=>m.stage==='main-before-data'&&m.seq===receive.seq&&m.pid===receive.pid&&m.tid===receive.tid);
  const postEnd=post&&inWindow.find(m=>m.stage==='main-post'&&m.edge==='end'&&m.projectGeneration===generation&&m.requestId===post.requestId&&m.ts>=post.ts);
  const resultPost=receive&&inWindow.find(m=>m.stage==='result-post'&&m.edge==='start'&&m.projectGeneration===generation&&m.requestId===receive.requestId);
  const resultEnd=resultPost&&inWindow.find(m=>m.stage==='result-post'&&m.edge==='end'&&m.projectGeneration===generation&&m.requestId===receive.requestId&&m.ts>=resultPost.ts);
  const previousEnd=workerBefore&&postEnd&&marks.filter(m=>m.stage==='packet-prepare-total'&&m.edge==='end'&&m.pid===workerBefore.pid&&m.tid===workerBefore.tid&&m.ts>=postEnd.ts&&m.ts<=workerBefore.ts).at(-1);
  const previousStart=previousEnd&&marks.filter(m=>m.stage==='packet-prepare-total'&&m.edge==='start'&&m.pid===previousEnd.pid&&m.tid===previousEnd.tid&&m.requestId===previousEnd.requestId&&m.projectGeneration===previousEnd.projectGeneration&&m.ts<=previousEnd.ts).at(-1);
  const previousOverlap=previousStart&&previousEnd&&postEnd&&workerBefore?Math.max(0,Math.min(previousEnd.ts,workerBefore.ts)-Math.max(previousStart.ts,postEnd.ts))/1000:null;
  const published=inWindow.find(m=>m.stage==='boundary-published'&&m.generation===generation);
  const uploadWindow=receive&&published?inWindow.filter(m=>m.ts>=receive.ts&&m.ts<=published.ts):[];
  const steps=uploadWindow.filter(m=>m.stage==='upload-step'&&String(m.key).endsWith(':stroke-prepared'));const last=published&&inWindow.find(m=>m.ts>published.ts&&m.ts<=published.ts+20000&&m.stage==='upload-step'&&m.done&&String(m.key).endsWith(':stroke-prepared'));if(last)steps.push(last);const expectedKey=receive?`country-shared-boundary:${generation}:${receive.requestId}`:null;const gl=uploadWindow.filter(m=>m.stage==='buffer-sub-data'&&m.key===expectedKey),alloc=uploadWindow.filter(m=>m.stage==='buffer-data'&&m.key===expectedKey),resourceReady=uploadWindow.find(m=>m.stage==='resource-ready'&&m.key===expectedKey);
  const frameIds=steps.map(s=>frames.find(e=>e.pid===s.pid&&e.tid===s.tid&&e.ts<=s.ts&&e.ts+e.dur>=s.ts)?.ts).filter(Number.isFinite);
  const sortedFrames=[...new Set(frameIds)].sort((a,b)=>a-b),frameGaps=sortedFrames.slice(1).map((x,i)=>(x-sortedFrames[i])/1000);
  rows.push({run:r.name,index:s.index,target:s.target,displayMs:s.displayMs,readyMs:s.readyMs,hash:s.semantic.hash,longTaskMs:Math.max(0,...s.longTasks.map(t=>t.ms)),generation,cacheHit:resultPost?.packetCacheHit??null,requestId:receive?.requestId??null,resourceKey:expectedKey,requestToPostMs:post?(post.ts-start.ts)/1000:null,postCallMs:post&&postEnd?(postEnd.ts-post.ts)/1000:null,postReturnToWorkerBeforeMs:postEnd&&workerBefore?(workerBefore.ts-postEnd.ts)/1000:null,priorPacketOverlapMs:previousOverlap,priorPacketGeneration:previousStart?.projectGeneration??null,priorPacketRequestId:previousStart?.requestId??null,priorPacketDurationMs:previousStart&&previousEnd?(previousEnd.ts-previousStart.ts)/1000:null,priorPacketStartRelativeMs:previousStart?(previousStart.ts-start.ts)/1000:null,workerDataAccessMs:workerBefore?(worker.ts-workerBefore.ts)/1000:null,resultPostCallMs:resultPost&&resultEnd?(resultEnd.ts-resultPost.ts)/1000:null,resultReturnToMainBeforeMs:resultEnd&&mainBefore?(mainBefore.ts-resultEnd.ts)/1000:null,mainDataAccessMs:mainBefore?(receive.ts-mainBefore.ts)/1000:null,receiveToPublishMs:receive&&published?(published.ts-receive.ts)/1000:null,readyToPublishMs:resourceReady&&published?(published.ts-resourceReady.ts)/1000:null,instancesBytes:resourceReady?.instances??null,nodesBytes:resourceReady?.nodes??null,workerAfterMs:worker?(worker.ts-start.ts)/1000:null,mainAfterMs:receive?(receive.ts-start.ts)/1000:null,publishMs:published?(published.ts-start.ts)/1000:null,uploadSteps:steps.length,uploadFrames:frameIds.length===steps.length?new Set(frameIds).size:null,frameMatches:frameIds.length,uploadFrameGapMaxMs:frameGaps.length?Math.max(...frameGaps):null,uploadFrameGapsOver25Ms:frameGaps.filter(x=>x>25).length,uploadStepBytes:steps.reduce((n,m)=>n+m.used,0),glBytes:gl.reduce((n,m)=>n+m.bytes,0),glCalls:gl.length,allocationCalls:alloc.length,glCpuMs:[...gl,...alloc].reduce((n,m)=>n+m.elapsed,0),maxUploadStepMs:Math.max(0,...steps.map(m=>m.elapsed)),inputPending:inWindow.filter(m=>m.stage==='input-pending').length});
 }
}
const stat=a=>{if(!a.length)return null;a.sort((x,y)=>x-y);const p=q=>{const i=(a.length-1)*q;return a[Math.floor(i)]+(a[Math.ceil(i)]-a[Math.floor(i)])*(i%1)};return{n:a.length,p50:p(.5),p90:p(.9),max:a.at(-1)}};
const conditions=Object.fromEntries(['A','B','A2'].map(k=>{const first=rows.filter(r=>r.run.startsWith('p4-'+k+'-')&&r.index===0);return[k,{display:stat(first.map(r=>r.displayMs)),over2500:first.filter(r=>r.displayMs>2500).length,first}]}));
writeFileSync(base+'/p4-analysis.json',JSON.stringify({rows,conditions},null,2));console.log(JSON.stringify(Object.fromEntries(Object.entries(conditions).map(([k,v])=>[k,{display:v.display,over2500:v.over2500}]))));
