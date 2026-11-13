import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { loadNodeCore } from '../build/load-node-core.mjs';
const {values}=parseArgs({options:{operations:{type:'string',default:'cut,polygon,river'},output:{type:'string'}}});
const selected=values.operations.split(',');
assert.ok(selected.length&&selected.every(name=>['cut','polygon','river'].includes(name)),'Unknown calculation operation');
const core=await loadNodeCore();
const metrics={};
for(const kind of selected){
 const corpus=JSON.parse(readFileSync(new URL('../../tests/fixtures/geometry/calculation-contracts/'+kind+'.json',import.meta.url),'utf8'));
 const rows=kind==='polygon'?corpus.filter(r=>r.expected.result).slice(0,8):kind==='cut'?corpus.filter(r=>!r.input.operation).slice(0,8):corpus.slice(0,8);
 const run=()=>{for(const {input}of rows){
  if(kind==='polygon')assert.ok(Array.isArray(core.polygonOperation(input.operation,input.operands,false)));
  else if(kind==='river')assert.ok(JSON.parse(core.riverPartitionCalculate('envelope',JSON.stringify(input))).result);
  else {const prepared=new core.PreparedCutGeometry(JSON.stringify(input.source));try{assert.equal(typeof JSON.parse(prepared.prepare(JSON.stringify(input))).valid,'boolean');}finally{prepared.delete();}}
 }};
 run();const samples=[];for(let i=0;i<5;i++){const start=performance.now();run();samples.push(performance.now()-start);}
 metrics[kind]={cases:rows.length,samplesMs:samples,medianMs:[...samples].sort((a,b)=>a-b)[2]};
}
const report={schema:'pando-calculation-diagnostic-v1',node:process.version,platform:process.platform,warmups:1,samples:5,scope:'Current Core and bounded synthetic inputs only; no historical speed or frame-rate claim',metrics};
if(values.output)writeFileSync(values.output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
