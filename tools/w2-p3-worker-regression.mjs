import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {writeFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.PANDOLAB_W3_EVIDENCE;if(!base)throw Error('Specify evidence directory');
const a='D:/dev/worktrees/w2-p3-before',b='D:/dev/worktrees/w2-p3-after';
function create(root){const moduleUrl=pathToFileURL(root+'/shared/frontend/js/workers/country-shared-boundary-worker.js').href,coreUrl=pathToFileURL(root+'/tools/load-spherical-core.mjs').href;
 const code=`import{parentPort}from'node:worker_threads';globalThis.self={location:{href:${JSON.stringify(moduleUrl)}},postMessage:(...args)=>parentPort.postMessage(...args)};await import(${JSON.stringify(coreUrl)});await import(${JSON.stringify(moduleUrl)});parentPort.on('message',data=>self.onmessage({data}));`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)));let requestId=0;
 return{worker,request:message=>new Promise((resolve,reject)=>{const id=++requestId;const timer=setTimeout(()=>reject(Error('Worker timeout')),30000);const onMessage=data=>{if(data.requestId!==id)return;clearTimeout(timer);worker.off('message',onMessage);worker.off('error',onError);data.type==='error'?reject(Error(data.message)):resolve(data);};const onError=e=>{clearTimeout(timer);worker.off('message',onMessage);reject(e);};worker.on('message',onMessage);worker.once('error',onError);worker.postMessage({type:'replace',projectGeneration:id,geometryRevision:id,quality:'canonical',...message,requestId:id});})};
}
const rectangle=(id,w,s,e,n,root=id)=>({type:'Feature',id,properties:{name:id,parentId:root===id?'':root},boundaryRootId:root,geometry:{type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}});
const rootFeatures=[rectangle('ROOT',0,0,4,4),rectangle('CHILD',0,0,2,4,'ROOT')];
const first=create(a),second=create(b),records=[];
try{
 const cases=[{name:'initial',features:rootFeatures,hit:false},{name:'identical-new-generation',features:structuredClone(rootFeatures),hit:true},{name:'identical-second-transfer',features:structuredClone(rootFeatures),hit:true},{name:'display-name',features:rootFeatures.map(f=>({...f,properties:{...f.properties,name:'renamed'}})),hit:true},{name:'quality-preview',features:rootFeatures,quality:'preview',hit:false},{name:'quality-canonical',features:rootFeatures,hit:false},{name:'hide-outlines',features:rootFeatures,includeOutlines:false,hit:false},{name:'restore-outlines',features:rootFeatures,includeOutlines:true,hit:false},{name:'ownership',features:rootFeatures.map(f=>f.id==='CHILD'?{...f,boundaryRootId:'CHILD',properties:{...f.properties,parentId:''}}:f),hit:false},{name:'geometry',features:[rootFeatures[0],rectangle('CHILD',0,0,2.00000001,4,'ROOT')],hit:false}];
 for(const item of cases){const {name,hit,...request}=item;const before=await first.request(request),after=await second.request(request);assert.equal(Object.hasOwn(before,'packetCacheHit'),false,'A must not gain invented cache telemetry');assert.equal(after.packetCacheHit,hit,name);assert.deepEqual(after.packet,before.packet,name+' output equality');assert.ok(after.packetCacheResidentEstimate<=96*1024**2);records.push({name,expectedHit:hit,actualHit:after.packetCacheHit,resident:after.packetCacheResidentEstimate,segments:after.packet.segments.length});}
}finally{await first.worker.terminate();await second.worker.terminate();}
const file=base+'/worker-invalidation-regression.json';if(existsSync(file))throw Error('Preserve evidence');writeFileSync(file,JSON.stringify({passed:true,records},null,2));console.log('W3_WORKER_REGRESSION '+JSON.stringify(records));
