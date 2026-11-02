import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Missing evidence path');const rows=[];
for(let i=0;i<3;i++){
 const name='p4-early-'+i,r=JSON.parse(readFileSync(base+'/'+name+'.json'));if(r.status!=='passed')throw Error('Incomplete '+name);
 const events=JSON.parse(gunzipSync(readFileSync(base+'/'+name+'-trace.json.gz'))).traceEvents;
 const marks=events.filter(e=>e.name?.startsWith('W2|')||e.name?.startsWith('W4|')).map(e=>({...JSON.parse(e.name.slice(3)),ts:e.ts,local:e.args?.data?.startTime,pid:e.pid,tid:e.tid})).sort((a,b)=>a.ts-b.ts);
 const start=marks.find(m=>m.stage==='transition'&&m.edge==='requested'&&Math.abs(m.local-r.samples[0].requested)<2),end=marks.find(m=>m.stage==='transition'&&m.edge==='presented'&&m.ts>=start.ts);if(!start||!end)throw Error('Missing transition');
 const active=new Map(),spans=[];
 for(const m of marks){const key=[m.pid,m.tid,m.stage,m.spanId??''].join(':');if(m.edge==='start'){const stack=active.get(key)||[];stack.push(m);active.set(key,stack);}else if(m.edge==='end'){const s=active.get(key)?.pop();if(s&&m.ts>=start.ts&&s.ts<=end.ts)spans.push({stage:m.stage,requestId:s.requestId,generation:s.generation,startMs:(s.ts-start.ts)/1000,endMs:(m.ts-start.ts)/1000,durationMs:(m.ts-s.ts)/1000,pid:m.pid,tid:m.tid});}}
 rows.push({name,displayMs:r.samples[0].displayMs,spans,cache:marks.filter(m=>m.stage==='source-cache'&&m.ts>=start.ts&&m.ts<=end.ts).map(m=>({atMs:(m.ts-start.ts)/1000,month:m.month,hit:m.hit,generation:m.generation,background:m.background}))});
}
writeFileSync(base+'/early-analysis.json',JSON.stringify({rows},null,2));console.log('W4_EARLY_ANALYZED',rows.length);
