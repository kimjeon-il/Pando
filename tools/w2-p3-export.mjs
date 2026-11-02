import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Specify evidence directory');
const read=n=>{const file=base+'/'+n+(existsSync(base+'/'+n)?'':'.gz');const bytes=readFileSync(file);return JSON.parse(file.endsWith('.gz')?gunzipSync(bytes):bytes);};
const a=read('analysis.json');
const csv=(name,rows)=>{const keys=[...new Set(rows.flatMap(Object.keys))];const quote=v=>JSON.stringify(v??'');writeFileSync(base+'/'+name,keys.join(',')+'\n'+rows.map(r=>keys.map(k=>quote(r[k])).join(',')).join('\n')+'\n');};
csv('transitions.csv',a.runs.flatMap(r=>r.samples.map(s=>({run:r.name,index:s.index,target:s.target,displayMs:s.display,readyMs:s.ready,maxLongTaskMs:s.longTask,workerRequests:s.acceptedWorker,cacheHits:r.name.startsWith('B-')?s.workerCacheHits:null,hash:s.hash,labels:s.labels}))));
const timelines=[];
for(const r of a.runs.filter(r=>r.kind==='performance')){
 const raw=read(r.name+'.json');
 const events=JSON.parse(gunzipSync(readFileSync(base+'/'+r.name+'-trace.json.gz'))).traceEvents;
 const marks=events.filter(e=>e.name?.startsWith('W2|')).map(e=>({...JSON.parse(e.name.slice(3)),ts:e.ts,pid:e.pid,tid:e.tid,local:e.args?.data?.startTime})).sort((x,y)=>x.ts-y.ts);
 const s=r.samples[0],start=marks.find(m=>m.stage==='transition'&&m.edge==='requested'&&Math.abs(m.local-raw.samples[0].requested)<2),end=start.ts+s.display*1000;
 const gates=marks.filter(m=>m.stage==='gate'&&m.ts>=start.ts&&m.ts<=end);
 const states=[];let prior='';for(const m of gates){const state={generation:m.generation,canonical:m.canonicalMeshReady,boundaries:m.boundariesReady,resources:m.resourcesDrawn,surface:m.surfaceQuality,physical:m.physicalReady,terrainNeeded:m.terrainNeeded,terrain:m.terrainReady};const key=JSON.stringify(state);if(key!==prior){states.push({atMs:(m.ts-start.ts)/1000,...state});prior=key;}}
 const stages=s.samplespans.filter(p=>!p.stage.startsWith('digest-')&&s.acceptedRequests.some(q=>q.id===p.requestId&&q.generation===p.generation)).map(p=>({stage:p.stage,startMs:p.relativeStartMs,endMs:p.relativeEndMs,durationMs:p.ms,requestId:p.requestId,generation:p.generation}));
 const points=marks.filter(m=>['worker-receive','boundary-published'].includes(m.stage)&&m.ts>=start.ts&&m.ts<=end).map(m=>({stage:m.stage,atMs:(m.ts-start.ts)/1000,requestId:m.requestId,generation:m.projectGeneration??m.generation}));
 const layers=events.filter(e=>e.name==='LayerTreeHost::DoUpdateLayers'&&e.ph==='X'&&e.ts>=start.ts&&e.ts<=end).map(e=>e.dur/1000);
 timelines.push({run:r.name,displayMs:s.display,readyMs:s.ready,stages,points,gates:states,lastObservedGate:states.at(-1),coreRelease:s.release.map(p=>({wallMs:p.ms,workerMs:p.workerMs})),layerUpdate:{count:layers.length,maxMs:layers.length?Math.max(...layers):null,totalMs:layers.reduce((n,v)=>n+v,0)}});
}
writeFileSync(base+'/first-transition-timelines.json',JSON.stringify(timelines,null,2));
csv('first-worker-stages.csv',timelines.flatMap(r=>r.stages.map(s=>({run:r.run,...s}))));
const memory=[];for(const file of readdirSync(base).filter(n=>/^(?:A|B|A2)-(?:memory|untraced-memory|forced-memory)\.json(?:\.gz)?$/.test(n))){const r=read(file);for(const c of r.checkpoints){for(const phase of ['before','after']){const p=c[phase],w=p.workers.workers.find(w=>w.url.includes('country-shared-boundary-worker.js'));memory.push({run:r.name,at:c.at,gc:phase,mainHeap:p.main.usedSize,boundaryHeap:w?.jsHeap.usedBytes,boundaryWasm:w?.wasmLinearMemory.allocatedBytes,allWorkerHeap:p.workers.jsUsedBytes,allWorkerWasm:p.workers.wasmAllocatedBytes,cacheBytes:p.cache.residentBytes,cachePackets:p.cache.count,privateBytes:[p.native].flat().reduce((n,v)=>n+v.PrivateMemorySize64,0),workingSet:[p.native].flat().reduce((n,v)=>n+v.WorkingSet64,0)});}}}
csv('memory.csv',memory);
console.log(JSON.stringify(timelines.filter(r=>['A-cold-1','B-cold-1','A2-cold-1'].includes(r.run))));
