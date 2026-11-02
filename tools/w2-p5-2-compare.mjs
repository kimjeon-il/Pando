import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Missing evidence path');
const q=(v,p)=>{v=v.filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return null;const i=(v.length-1)*p;return v[Math.floor(i)]+(v[Math.ceil(i)]-v[Math.floor(i)])*(i%1);};
const summary=v=>({n:v.length,p50:q(v,.5),p90:q(v,.9),max:v.length?Math.max(...v):null,over2500:v.filter(x=>x>2500).length});
const conditions={};
for(const condition of ['A','B1','A2']){
 const rows=[],warm=[];
 for(let i=0;i<10;i++){
  const name=`p5-${condition}-cold-${i}`,run=JSON.parse(readFileSync(`${base}/${name}.json`));if(run.status!=='passed')throw Error(`Invalid ${name}`);
  const events=JSON.parse(gunzipSync(readFileSync(`${base}/${name}-trace.json.gz`))).traceEvents;
  const marks=events.filter(e=>['W2|','W4|','W5|'].some(p=>e.name?.startsWith(p))).map(e=>({...JSON.parse(e.name.slice(3)),ts:e.ts,local:e.args?.data?.startTime,pid:e.pid,tid:e.tid})).sort((a,b)=>a.ts-b.ts);
  const sample=run.samples[0],start=marks.find(m=>m.stage==='transition'&&m.edge==='requested'&&Math.abs(m.local-sample.requested)<2),present=marks.find(m=>m.stage==='transition'&&m.edge==='presented'&&m.ts>=start?.ts);if(!start||!present)throw Error(`Missing transition ${name}`);
  const during=marks.filter(m=>m.ts>=start.ts&&m.ts<=present.ts),gate=during.filter(m=>m.stage==='gate').at(-1),generation=gate?.generation;
  const receive=during.find(m=>m.stage==='main-after-data'&&m.projectGeneration===generation),post=during.find(m=>m.stage==='main-post'&&m.edge==='end'&&m.requestId===receive?.requestId&&m.projectGeneration===generation),worker=receive&&during.find(m=>m.stage==='worker-after-data'&&m.projectGeneration===generation&&m.requestId===receive.requestId),before=worker&&during.find(m=>m.stage==='worker-before-data'&&m.seq===worker.seq&&m.pid===worker.pid&&m.tid===worker.tid);
  const mark=stage=>during.filter(m=>m.stage===stage),proof=mark('proof-start'),proofEnd=mark('proof-end'),adopt=mark('join-adopt'),candidate=mark('join-candidate'),result=receive&&marks.find(m=>m.stage==='result-post'&&m.edge==='start'&&m.requestId===receive.requestId&&m.projectGeneration===generation);
  const published=during.find(m=>m.stage==='boundary-published'&&m.generation===generation);
  rows.push({name,displayMs:sample.displayMs,readyMs:sample.readyMs,firstPresentationSinceNavigationMs:sample.requested+sample.displayMs,semanticSha256:sample.semantic.hash,generation,requestId:receive?.requestId??null,workerCacheHit:result?.packetCacheHit??null,workerWaitMs:before&&post?(before.ts-post.ts)/1000:null,requestToPublishMs:published?(published.ts-start.ts)/1000:null,joined:adopt.length,candidates:candidate.length,fallbacks:mark('join-fallback').map(m=>m.reason),nativePosts:mark('native-post-start').length,proofs:proof.map(m=>({requestId:m.requestId,bytes:m.bytes,cloneMs:m.cloneMs,encodeMs:m.encodeMs,wallMs:proofEnd.find(n=>n.requestId===m.requestId&&n.projectGeneration===m.projectGeneration)?.wallMs??null})),maxLongTaskMs:Math.max(0,...sample.longTasks.map(t=>t.ms))});
  if(i===9)warm.push(...run.samples.slice(2).map(s=>({displayMs:s.displayMs,readyMs:s.readyMs,semanticSha256:s.semantic.hash,target:s.target})));
 }
 conditions[condition]={display:summary(rows.map(r=>r.displayMs)),ready:summary(rows.map(r=>r.readyMs)),firstPresentationSinceNavigation:summary(rows.map(r=>r.firstPresentationSinceNavigationMs)),warmDisplay:summary(warm.map(r=>r.displayMs)),joined:rows.reduce((n,r)=>n+r.joined,0),candidates:rows.reduce((n,r)=>n+r.candidates,0),nativeHits:rows.filter(r=>r.workerCacheHit===true).length,noReceivedWorker:rows.filter(r=>r.requestId===null).length,workerWait:summary(rows.map(r=>r.workerWaitMs).filter(Number.isFinite)),rows,warm};
}
writeFileSync(`${base}/comparison.json`,JSON.stringify({conditions},null,2));for(const [k,v]of Object.entries(conditions))console.log(k,JSON.stringify({display:v.display,ready:v.ready,warm:v.warmDisplay,joined:v.joined,candidates:v.candidates,workerWait:v.workerWait}));
