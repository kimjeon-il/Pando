import{readFileSync,writeFileSync}from'node:fs';import{gunzipSync}from'node:zlib';import{createHash}from'node:crypto';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Missing evidence path');const rows=[];const hash=s=>createHash('sha256').update(s).digest('hex');
for(let i=0;i<10;i++){
 const name='p5-A-cold-'+i,r=JSON.parse(readFileSync(base+'/'+name+'.json'));if(r.status!=='passed')throw Error('Incomplete '+name);
 const trace=JSON.parse(gunzipSync(readFileSync(base+'/'+name+'-trace.json.gz'))).traceEvents;
 const marks=trace.filter(e=>['W2|','W4|','W5|'].some(p=>e.name?.startsWith(p))).map(e=>({...JSON.parse(e.name.slice(3)),ts:e.ts,local:e.args?.data?.startTime,pid:e.pid,tid:e.tid})).sort((a,b)=>a.ts-b.ts);
 const sample=r.samples[0],start=marks.find(m=>m.stage==='transition'&&m.edge==='requested'&&Math.abs(m.local-sample.requested)<2);if(!start)throw Error('Missing request clock '+name);
 const presented=marks.find(m=>m.stage==='transition'&&m.edge==='presented'&&m.ts>=start.ts);const ready=marks.find(m=>m.stage==='transition'&&m.edge==='ready'&&m.ts>=start.ts);if(!presented||!ready)throw Error('Missing present/ready');
 const initial=marks.find(m=>m.stage==='initial-presented'),initialBoundary=initial&&marks.filter(m=>m.stage==='boundary-published'&&m.ts<=initial.ts).at(-1);
 const initialPacketStart=marks.find(m=>m.stage==='packet-prepare-total'&&m.edge==='start'&&m.projectGeneration===1&&m.requestId===3);
 const initialPacketEnd=initialPacketStart&&marks.find(m=>m.stage==='packet-prepare-total'&&m.edge==='end'&&m.projectGeneration===1&&m.requestId===3&&m.ts>=initialPacketStart.ts);
 const initialPacketSend=initialPacketEnd&&marks.find(m=>m.stage==='result-post'&&m.edge==='start'&&m.projectGeneration===1&&m.requestId===3&&m.ts>=initialPacketEnd.ts);
 const initialPacketPublish=initialPacketEnd&&marks.find(m=>m.stage==='boundary-published'&&m.generation===1&&m.ts>=initialPacketEnd.ts);
 const gate=marks.filter(m=>m.stage==='gate'&&m.ts>=start.ts&&m.ts<=presented.ts).at(-1),generation=gate?.generation;
 const receive=marks.find(m=>m.stage==='main-after-data'&&m.projectGeneration===generation&&m.ts>=start.ts&&m.ts<=presented.ts);
 const post=marks.find(m=>m.stage==='main-post'&&m.edge==='start'&&m.projectGeneration===generation&&m.requestId===receive?.requestId&&m.ts>=start.ts);
 const postEnd=post&&marks.find(m=>m.stage==='main-post'&&m.edge==='end'&&m.projectGeneration===generation&&m.requestId===post.requestId&&m.ts>=post.ts);
 const worker=receive&&marks.find(m=>m.stage==='worker-after-data'&&m.projectGeneration===generation&&m.requestId===receive.requestId&&m.ts>=start.ts);
 const before=worker&&marks.find(m=>m.stage==='worker-before-data'&&m.seq===worker.seq&&m.pid===worker.pid&&m.tid===worker.tid);
 const priorEnd=before&&postEnd&&marks.filter(m=>m.stage==='packet-prepare-total'&&m.edge==='end'&&m.pid===before.pid&&m.tid===before.tid&&m.ts>=postEnd.ts&&m.ts<=before.ts).at(-1);
 const priorStart=priorEnd&&marks.filter(m=>m.stage==='packet-prepare-total'&&m.edge==='start'&&m.pid===priorEnd.pid&&m.tid===priorEnd.tid&&m.requestId===priorEnd.requestId&&m.projectGeneration===priorEnd.projectGeneration&&m.ts<=priorEnd.ts).at(-1);
 const identities=marks.filter(m=>m.stage==='packet-identity').map(m=>{const key=JSON.parse(m.key);return{atMs:(m.ts-start.ts)/1000,requestId:m.requestId,generation:m.projectGeneration,geometryRevision:m.geometryRevision,quality:m.quality,includeOutlines:m.includeOutlines,featureCount:key[2].length,identitySha256:hash(m.key),geometryHashes:key[2].map(x=>({id:x[0],root:x[1],parent:x[2],geometrySha256:x[3]}))}});
 const result=receive&&marks.find(m=>m.stage==='result-post'&&m.edge==='start'&&m.requestId===receive.requestId&&m.projectGeneration===generation);
 const publish=receive&&marks.find(m=>m.stage==='boundary-published'&&m.generation===generation&&m.ts>=receive.ts&&m.ts<=presented.ts);
 rows.push({name,displayMs:sample.displayMs,readyMs:sample.readyMs,hash:sample.semantic.hash,initialPresentedMs:initial?(initial.ts-start.ts)/1000:null,initialBoundaryPublishedMs:initialBoundary?(initialBoundary.ts-start.ts)/1000:null,initialBoundaryGeneration:initialBoundary?.generation??null,initialPacketStartMs:initialPacketStart?(initialPacketStart.ts-start.ts)/1000:null,initialPacketEndMs:initialPacketEnd?(initialPacketEnd.ts-start.ts)/1000:null,initialPacketSendMs:initialPacketSend?(initialPacketSend.ts-start.ts)/1000:null,initialPacketPublishMs:initialPacketPublish?(initialPacketPublish.ts-start.ts)/1000:null,generation,requestId:receive?.requestId??null,cacheHit:result?.packetCacheHit??null,requestToPostMs:post?(post.ts-start.ts)/1000:null,workerWaitMs:before&&postEnd?(before.ts-postEnd.ts)/1000:null,priorPacketOverlapMs:priorStart&&priorEnd?Math.max(0,Math.min(priorEnd.ts,before.ts)-Math.max(priorStart.ts,postEnd.ts))/1000:null,priorPacketGeneration:priorStart?.projectGeneration??null,priorPacketRequestId:priorStart?.requestId??null,publishMs:publish?(publish.ts-start.ts)/1000:null,identities});
}
const q=(x,p)=>{x=x.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const i=(x.length-1)*p;return x[Math.floor(i)]+(x[Math.ceil(i)]-x[Math.floor(i)])*(i%1)};
const summary={n:rows.length,displayP50:q(rows.map(r=>r.displayMs),.5),displayP90:q(rows.map(r=>r.displayMs),.9),max:Math.max(...rows.map(r=>r.displayMs)),over2500:rows.filter(r=>r.displayMs>2500).length,cacheHit:rows.filter(r=>r.cacheHit===true).length,noWorker:rows.filter(r=>r.requestId===null).length,blocked:rows.filter(r=>r.priorPacketOverlapMs>0).length,workerWaitP50:q(rows.map(r=>r.workerWaitMs),.5)};
writeFileSync(base+'/baseline-analysis.json',JSON.stringify({summary,rows},null,2));console.log('W5_BASELINE',JSON.stringify(summary));
