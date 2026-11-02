import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {gunzipSync} from 'node:zlib';

const dir=resolve(process.argv[2]||'.w2-p5-library/reports/development/performance/w2-p4-2-windows-gpu-2026-11-02');
const destination=resolve(process.argv[3]||'test-results/w2-p5-inflight-audit');
const read=(name)=>{
  let bytes;try{bytes=readFileSync(join(dir,name));}
  catch(error){if(error.code!=='ENOENT')throw error;bytes=gunzipSync(readFileSync(join(dir,name+'.gz')));}
  return bytes.toString('utf8');
};
const source=read('README.md');
if(!source.includes('fe8282ba32761ab9586348d1712e11cc1f4e7882')||
  !source.includes('data-f50b7f480c812df6f5ea0c40f5461ab0'))
 throw Error('W2-P4-2 code/data pin mismatch');
const audit=JSON.parse(read('final-audit.json'));
if(!audit.passed||audit.allPrimaryTransitions!==120||!audit.protectedHashesMatch)
 throw Error('W2-P4-2 primary evidence was not verified');
const {conditions,rows}=JSON.parse(read('p4-analysis.json'));
if(rows.length!==120)throw Error('Expected 120 primary transitions');
const round=x=>Number(x.toFixed(3));
const median=values=>{
 const s=values.slice().sort((a,b)=>a-b),n=s.length;
 return n?round(n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2):null;
};
const percentile=(values,p)=>{
 const s=values.slice().sort((a,b)=>a-b),i=(s.length-1)*p;
 return s.length?round(s[Math.floor(i)]+(s[Math.ceil(i)]-s[Math.floor(i)])*(i-Math.floor(i))):null;
};
const summarize=(rows,key)=>{
 const nums=rows.map(row=>row[key]).filter(Number.isFinite);
 return {n:nums.length,p50:median(nums),p90:percentile(nums,.9),
   min:nums.length?round(Math.min(...nums)):null,max:nums.length?round(Math.max(...nums)):null};
};
const groups={};
for(const [arm,stepBytes] of [['A',262144],['B',1048576],['A2',262144]]){
 const first=conditions[arm]?.first;
 if(first?.length!==10)throw Error(arm+' cold samples missing');
 const hit=first.filter(row=>row.cacheHit===true);
 const noWorker=first.filter(row=>row.requestId===null);
 const blocked=hit.filter(row=>Number.isFinite(row.priorPacketOverlapMs));
 groups[arm]={stepBytes,all:summarize(first,'displayMs'),hitN:hit.length,
  noWorkerN:noWorker.length,hitPresented:summarize(hit,'displayMs'),
  listenWait:summarize(hit,'postReturnToWorkerBeforeMs'),
  priorWorkOverlap:summarize(blocked,'priorPacketOverlapMs'),
  uploadWait:summarize(hit,'receiveToPublishMs'),
  uploadFrames:summarize(hit,'uploadFrames'),
  oldOverlapN:blocked.length,
  cases:hit.map(row=>({
    run:row.run,currentGeneration:row.generation,currentRequestId:row.requestId,
    priorGeneration:row.priorPacketGeneration,priorRequestId:row.priorPacketRequestId,
    cacheHit:row.cacheHit,priorPacketStartRelativeMs:row.priorPacketStartRelativeMs,
    listenerWaitMs:row.postReturnToWorkerBeforeMs,
    priorPacketOverlapMs:row.priorPacketOverlapMs,
    residualWaitBeyondOverlapMs:Number.isFinite(row.priorPacketOverlapMs)
      ?round(row.postReturnToWorkerBeforeMs-row.priorPacketOverlapMs):null,
    presentedMs:row.displayMs
  })),
 };
 if(hit.length+noWorker.length!==10)throw Error(arm+' incomplete no-worker classification');
 if(hit.some(row=>row.glBytes!==5426656))throw Error(arm+' changed boundary upload bytes');
}
if(groups.B.hitN!==8||groups.B.oldOverlapN!==8||
  groups.A.oldOverlapN!==0||groups.A2.oldOverlapN!==0)
 throw Error('Archived A/B/A2 contention pattern changed');
for(const row of groups.B.cases){
 if(row.priorGeneration!==1||row.priorRequestId!==3||
   row.currentGeneration!==2||row.currentRequestId!==5)
   throw Error('W2-P5 previous/current request association changed: '+row.run);
 if(row.residualWaitBeyondOverlapMs<0||
   row.residualWaitBeyondOverlapMs>1.0)
   throw Error('Mismatch of same-thread blocking interval: '+row.run);
}
const result={
 schema:'pando-w2-p5-startup-previous-packet-competition-v1',
 source:'kimjeon-il/PandoLab-library-data@3e63d665f70972902a68008e0d14ec26a2506bad',
 file:'reports/development/performance/w2-p4-2-windows-gpu-2026-11-02/p4-analysis.json',
 productSource:'fe8282ba32761ab9586348d1712e11cc1f4e7882',
 data:'data-f50b7f480c812df6f5ea0c40f5461ab0',
 verifiedTransitions:audit.allPrimaryTransitions,
 controlledSteps:'256KiB / 1MiB / 256KiB',
 groups,
 interpretation:[
  'B hit 8/8 contains previous-generation request 3 blocking new-generation request 5.',
  'New B cacheHit=true means the previous calculated packet identity was useful for the newer request.',
  'Aborting it before any packet is retained can force a new full packet computation; do not assume an end-to-end win from reducing wait alone.',
  'Synthetic Node worker cancellation tests check the protocol, not GTX 1650 hardware performance.',
  'The reason the previous packet overlapped B but not A/A2 is not established.',
  'Measurements were partially confounded by an interim analysis process; do not infer B upload budget caused the queue contention.',
 ]};
mkdirSync(destination,{recursive:true});
writeFileSync(join(destination,'w2-p5-inflight-audit.json'),JSON.stringify(result,null,2)+'\n');
console.log('W2P5_INFLIGHT_AUDIT '+JSON.stringify({
 steps:result.controlledSteps,groups:Object.fromEntries(Object.entries(groups).map(([name,g])=>
  [name,{first:g.all.p50,hit:g.hitN,noWorker:g.noWorkerN,oldOverlap:g.oldOverlapN,
    listenWait:g.listenWait.p50,priorWorkOverlap:g.priorWorkOverlap.p50,
    uploadWait:g.uploadWait.p50}]))
}));
