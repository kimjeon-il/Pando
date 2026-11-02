// Produce the original group-balanced tile order using the source-bound native engine.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {delimiter,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parseArgs} from 'node:util';
import {verifyNativeTool} from '../native-tool.mjs';
import {reportArgument} from '../report-paths.mjs';
import {matchingTorchLibrary,referenceBatchSourceFiles} from './native-infer.mjs';
import {corpusFingerprint,readTrainingBounded} from './training-evidence.mjs';
import {indexTrainingDataset,inspectCombinedTrainingData} from './training-tiles.mjs';
import {encodedWeights,verifyTrainingSupervision} from './training-supervision.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
// Entries are reused only after supervision verification rechecks every bound
// source; changes to manifest or source identities select a different entry.
const uniformTileCounts=new Map();
export function assertUniformTrainingOrder(bytes,total){
  if(!Buffer.isBuffer(bytes)||!Number.isSafeInteger(total)||total<1||total>1000000||bytes.length!==total*8)
    throw Error('Uniform training order must visit all tiles');
  const seen=new Set();for(let offset=0;offset<bytes.length;offset+=8){const index=bytes.readBigUInt64LE(offset);
    if(index>=BigInt(total)||seen.has(index))throw Error('Uniform training order contains an invalid index');seen.add(index);}
}
function trainingOrderTool({root,directory=resolve(root,'build-native/reference-analysis/training-batch'),torchLibrary}){
  if(!['win32','linux'].includes(process.platform)||!torchLibrary)throw Error('Explicit native training order inputs required');
  const executable=process.platform==='win32'?'pando-reference-training-batch.exe':'pando-reference-training-batch';
  const {binary,manifest}=verifyNativeTool({root,directory,target:'reference-training-batch',executable,sourceFiles:referenceBatchSourceFiles});
  return {binary,manifest,library:matchingTorchLibrary(torchLibrary,manifest)};
}
// Prepare a source-bound mixed-corpus sampling order and weights; no training or model admission.
export async function writeCombinedTrainingOrder({corpus,auxiliary,macroOnly,sampling='balanced',epoch,seed,output,torchLibrary,root=defaultRoot,directory,signal,verifyEvidence}){
  signal?.throwIfAborted();
  if(!corpus||!auxiliary||!output||!torchLibrary||typeof macroOnly!=='boolean'||!['balanced','uniform'].includes(sampling)||
    !Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(seed)||seed<0||!Number.isSafeInteger(epoch+seed))
    throw Error('Explicit combined training order inputs required');
  if(existsSync(output))throw Error('Training order output exists; preserve it');
  const data=await inspectCombinedTrainingData({corpus,auxiliary,macroOnly,signal,verifyEvidence});
  const {bytes,unobservedMask}=encodedWeights(data.counts),target=resolve(output),order=join(target,'order.u64');
  trainingOrderTool({root,directory,torchLibrary});
  signal?.throwIfAborted();mkdirSync(target);
  const result=await writeSampledTrainingOrder({datasets:data.datasets.map(rows=>rows.map(row=>row.duplicateGroup)),sampling,epoch,seed,
    output:order,torchLibrary,root,directory,signal});
  if(await corpusFingerprint(corpus,auxiliary)!==data.lineageFingerprint)throw Error('Training sources changed during order preparation; preserve the output');
  writeFileSync(join(target,'weights.f32'),bytes,{flag:'wx'});
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,independentEvaluation:false,macroOnly:false,
    lineageFingerprint:data.lineageFingerprint,counts:data.counts,unobservedMask,weightsSha256:createHash('sha256').update(bytes).digest('hex'),
    sampling,epoch,seed,length:result.length,orderSha256:result.sha256,datasetLengths:data.datasets.map(rows=>rows.length),toolRevision:result.toolRevision};
  writeFileSync(join(target,'order.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
export async function verifyCombinedTrainingOrder({corpus,auxiliary,orderDirectory,macroOnly,epoch,seed,signal,verifyEvidence}){
  signal?.throwIfAborted();
  if(!corpus||!auxiliary||!orderDirectory||typeof macroOnly!=='boolean'||!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(seed)||seed<0)
    throw Error('Explicit combined training order inputs required');
  const target=resolve(orderDirectory),receipt=JSON.parse(readTrainingBounded(join(target,'order.json'),1024*1024));
  const order=readTrainingBounded(join(target,'order.u64'),8000000),weights=readTrainingBounded(join(target,'weights.f32'),28);
  const data=await inspectCombinedTrainingData({corpus,auxiliary,macroOnly,signal,verifyEvidence}),expected=encodedWeights(data.counts);
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  if(weights.length!==28||!weights.equals(expected.bytes)||receipt.weightsSha256!==digest(weights)||receipt.unobservedMask!==expected.unobservedMask)
    throw Error('Combined training weights differ');
  if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.independentEvaluation!==false||receipt.macroOnly!==false||
    receipt.lineageFingerprint!==data.lineageFingerprint||receipt.epoch!==epoch||receipt.seed!==seed||
    JSON.stringify(receipt.counts)!==JSON.stringify(data.counts)||JSON.stringify(receipt.datasetLengths)!==JSON.stringify(data.datasets.map(rows=>rows.length))||
    !Number.isSafeInteger(receipt.length)||receipt.length<1||order.length!==receipt.length*8||receipt.orderSha256!==digest(order))
    throw Error('Combined training order differs from source or receipt');
  const total=data.datasets.reduce((sum,rows)=>sum+rows.length,0);
  const sampling=receipt.sampling??'balanced';if(!['balanced','uniform'].includes(sampling))throw Error('Invalid combined training sampling');
  if(sampling==='uniform')assertUniformTrainingOrder(order,total);
  else for(let offset=0;offset<order.length;offset+=8)if(order.readBigUInt64LE(offset)>=BigInt(total))throw Error('Combined training order contains an invalid index');
  return {...data,sampling,orderSha256:receipt.orderSha256,weightsSha256:receipt.weightsSha256,unobservedMask:receipt.unobservedMask,length:receipt.length};
}
export async function writeSampledTrainingOrder({datasets,sampling='balanced',epoch,seed,output,torchLibrary,root=defaultRoot,
  directory=resolve(root,'build-native/reference-analysis/training-batch'),signal}){
  signal?.throwIfAborted();
  if(!['win32','linux'].includes(process.platform)||!output||!torchLibrary)throw Error('Explicit native training order inputs required');
  if(existsSync(output))throw Error('Training order output exists; preserve it');
  if(!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(seed)||seed<0||!Number.isSafeInteger(epoch+seed)||
    !Array.isArray(datasets)||!datasets.length||datasets.length>64||!['balanced','uniform'].includes(sampling))throw Error('Valid training epoch, seed, sampling and corpora required');
  if(sampling==='uniform'){
    let count=0,groupBytes=0;
    for(const rows of datasets){if(!Array.isArray(rows)||!rows.length||rows.length>1000000-count)throw Error('Invalid training tile count');
      count+=rows.length;for(const group of rows){if(typeof group!=='string'||!group||!group.isWellFormed()||group.includes('\0'))throw Error('Valid training duplicate group required');
        const size=Buffer.byteLength(group);groupBytes+=size;if(size>1024||groupBytes>64*1024*1024)throw Error('Training group exceeds byte budget');}}
    // One unique group per tile uses the existing deterministic native shuffle,
    // without balancing or repeating any original source.
    datasets=[Array.from({length:count},(_,index)=>String(index).padStart(7,'0'))];
  }
  const pieces=[],number=value=>{const bytes=Buffer.allocUnsafe(4);bytes.writeUInt32LE(value);pieces.push(bytes);};
  let total=0,largest=0,groupBytes=0;number(datasets.length);
  for(const rows of datasets){if(!Array.isArray(rows)||!rows.length||rows.length>1000000-total)throw Error('Invalid training tile count');
    total+=rows.length;number(rows.length);const groups=new Set();
    for(const group of rows){if(typeof group!=='string'||!group||!group.isWellFormed()||group.includes('\0'))throw Error('Valid training duplicate group required');
      const bytes=Buffer.from(group);groupBytes+=bytes.length;if(bytes.length>1024||groupBytes>64*1024*1024)throw Error('Training group exceeds byte budget');
      number(bytes.length);pieces.push(bytes);groups.add(group);}
    largest=Math.max(largest,groups.size);
  }
  const length=Math.max(Math.ceil(total/datasets.length),largest)*datasets.length;
  if(length>1000000)throw Error('Training order exceeds budget');
  const {binary,manifest,library}=trainingOrderTool({root,directory,torchLibrary}),env={...process.env,
    ...(process.platform==='win32'?{PATH:library+delimiter+process.env.PATH}:{LD_LIBRARY_PATH:library+delimiter+(process.env.LD_LIBRARY_PATH||'')})};
  const child=spawn(binary,['order',String(epoch),String(seed)],{stdio:['pipe','pipe','pipe'],windowsHide:true,env,signal});
  const result=[],errors=[];let size=0,errorSize=0;
  const done=new Promise((accept,reject)=>{
    let settled=false;const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):accept();};
    const timer=setTimeout(()=>{child.kill();finish(Error('Native training order timed out'));},120000);
    child.on('error',finish);child.stdout.on('data',part=>{size+=part.length;if(size>length*8){child.kill();finish(Error('Training order exceeds expected length'));}else result.push(part);});
    child.stderr.on('data',part=>{errorSize+=part.length;if(errorSize<=65536)errors.push(part);});
    child.on('close',(code,reason)=>finish(code===0&&!reason?null:Error('Native training order failed: '+Buffer.concat(errors).toString('utf8'))));
  });done.catch(()=>{});
  try{await Promise.all([pipeline(Readable.from(pieces,{objectMode:false}),child.stdin,{signal}),done]);}
  catch(error){child.kill();await done.catch(()=>{});throw error;}
  signal?.throwIfAborted();const bytes=Buffer.concat(result);if(bytes.length!==length*8)throw Error('Native training order has incorrect length');
  for(let offset=0;offset<bytes.length;offset+=8)if(bytes.readBigUInt64LE(offset)>=BigInt(total))throw Error('Native training order contains an invalid index');
  if(sampling==='uniform')assertUniformTrainingOrder(bytes,total);
  writeFileSync(resolve(output),bytes,{flag:'wx'});
  return {length,sha256:createHash('sha256').update(bytes).digest('hex'),toolRevision:manifest.revision};
}
export async function writeTrainingOrder({corpus,supervision,reviewed=false,publisher=false,sampling='balanced',epoch,seed,output,torchLibrary,root=defaultRoot,directory,signal}){
  signal?.throwIfAborted();if(!corpus||!supervision||!output||!torchLibrary||!['balanced','uniform'].includes(sampling))throw Error('Explicit macro corpus, supervision and training order inputs required');
  if(!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(seed)||seed<0||!Number.isSafeInteger(epoch+seed))throw Error('Valid training epoch and seed required');
  if(existsSync(output)||existsSync(resolve(output)+'.receipt.json'))throw Error('Training order output exists; preserve it');
  const checked=await verifyTrainingSupervision({corpus,directory:supervision,reviewed,publisher,signal});
  const dataset=await indexTrainingDataset(corpus,{allowReviewed:reviewed,allowPublisher:publisher,signal});
  const result=await writeSampledTrainingOrder({datasets:[dataset.tiles.map(tile=>tile.duplicateGroup)],sampling,epoch,seed,output,torchLibrary,root,directory,signal});
  const corpusHash=createHash('sha256').update(readTrainingBounded(resolve(corpus),32*1024*1024)).digest('hex');
  const after=await verifyTrainingSupervision({corpus,directory:supervision,reviewed,publisher,signal});
  if(corpusHash!==dataset.corpusSha256||corpusHash!==checked.corpusSha256||after.sourcesSha256!==checked.sourcesSha256||after.weightsSha256!==checked.weightsSha256)
    throw Error('Training source changed during order preparation; preserve the output');
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,corpusSha256:dataset.corpusSha256,sourcesSha256:checked.sourcesSha256,
    weightsSha256:checked.weightsSha256,sampling,epoch,seed,length:result.length,orderSha256:result.sha256,toolRevision:result.toolRevision};
  writeFileSync(resolve(output)+'.receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
export async function verifyTrainingOrder({corpus,order,supervision,reviewed=false,publisher=false,epoch,seed,signal}){
  signal?.throwIfAborted();if(!corpus||!order||!supervision||!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(seed)||seed<0)
    throw Error('Explicit bound training order inputs required');
  const receipt=JSON.parse(readTrainingBounded(resolve(order)+'.receipt.json',1024*1024)),bytes=readTrainingBounded(resolve(order),8000000);
  const checked=await verifyTrainingSupervision({corpus,directory:supervision,reviewed,publisher,signal});
  if(receipt.schemaVersion!==1||receipt.trainingOnly!==true||receipt.releaseApproved!==false||receipt.corpusSha256!==checked.corpusSha256||
    receipt.sourcesSha256!==checked.sourcesSha256||receipt.weightsSha256!==checked.weightsSha256||receipt.epoch!==epoch||receipt.seed!==seed||
    !Number.isSafeInteger(receipt.length)||receipt.length<1||bytes.length!==receipt.length*8||
    receipt.orderSha256!==createHash('sha256').update(bytes).digest('hex'))throw Error('Bound training order differs from its source or receipt');
  const sampling=receipt.sampling??'balanced';if(!['balanced','uniform'].includes(sampling))throw Error('Invalid training sampling');
  if(sampling==='uniform'){
    const key=JSON.stringify([checked.corpusSha256,checked.sourcesSha256,reviewed,publisher]);let count=uniformTileCounts.get(key);
    if(count===undefined){const dataset=await indexTrainingDataset(corpus,{allowReviewed:reviewed,allowPublisher:publisher,signal});
      if(dataset.corpusSha256!==checked.corpusSha256)throw Error('Uniform training corpus changed');count=dataset.tiles.length;
      if(uniformTileCounts.size>=32)uniformTileCounts.delete(uniformTileCounts.keys().next().value);uniformTileCounts.set(key,count);}
    assertUniformTrainingOrder(bytes,count);
  }
  return {...checked,sampling,length:receipt.length,orderSha256:receipt.orderSha256};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{corpus:{type:'string'},auxiliary:{type:'string'},supervision:{type:'string'},epoch:{type:'string'},seed:{type:'string'},
      output:{type:'string'},sampling:{type:'string',default:'balanced'},'torch-library':{type:'string'},reviewed:{type:'boolean',default:false},publisher:{type:'boolean',default:false},'allow-nonmacro-auxiliary':{type:'boolean',default:false}}});
    if(positionals.length||!/^\d+$/.test(values.epoch||'')||!/^\d+$/.test(values.seed||''))throw Error('Explicit macro corpus, epoch, seed and output required');
    if(values.auxiliary&&(!values['allow-nonmacro-auxiliary']||values.supervision||values.reviewed||values.publisher))throw Error('Combined corpus requires explicit nonmacro auxiliary scope and no macro supervision directory');
    if(!values.auxiliary&&values['allow-nonmacro-auxiliary'])throw Error('Auxiliary corpus required for nonmacro scope');
    const common={corpus:reportArgument(values.corpus,{access:'read',siblings:true}),sampling:values.sampling,epoch:Number(values.epoch),seed:Number(values.seed),
      output:reportArgument(values.output,{access:'write'}),torchLibrary:values['torch-library']};
    console.log(JSON.stringify(values.auxiliary?await writeCombinedTrainingOrder({...common,auxiliary:reportArgument(values.auxiliary,{access:'read',siblings:true}),macroOnly:false}):
      await writeTrainingOrder({...common,supervision:reportArgument(values.supervision,{access:'read'}),reviewed:values.reviewed,publisher:values.publisher})));
  }catch(error){console.error('training-order: '+error.message);process.exitCode=1;}
}
