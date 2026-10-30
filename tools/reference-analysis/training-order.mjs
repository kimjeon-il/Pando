// Produce the original group-balanced tile order using the source-bound native engine.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,writeFileSync} from 'node:fs';
import {delimiter,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parseArgs} from 'node:util';
import {verifyNativeTool} from '../native-tool.mjs';
import {matchingTorchLibrary,referenceBatchSourceFiles} from './native-infer.mjs';
import {readTrainingBounded} from './training-evidence.mjs';
import {indexMacroTrainingDataset} from './training-tiles.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export async function writeBalancedTrainingOrder({datasets,epoch,seed,output,torchLibrary,root=defaultRoot,
  directory=resolve(root,'build-native/reference-analysis/training-batch'),signal}){
  signal?.throwIfAborted();
  if(!['win32','linux'].includes(process.platform)||!output||!torchLibrary)throw Error('Explicit native training order inputs required');
  if(existsSync(output))throw Error('Training order output exists; preserve it');
  if(!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(seed)||seed<0||!Number.isSafeInteger(epoch+seed)||
    !Array.isArray(datasets)||!datasets.length||datasets.length>64)throw Error('Valid training epoch, seed and corpora required');
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
  const executable=process.platform==='win32'?'pando-reference-training-batch.exe':'pando-reference-training-batch';
  const {binary,manifest}=verifyNativeTool({root,directory,target:'reference-training-batch',executable,sourceFiles:referenceBatchSourceFiles});
  const library=matchingTorchLibrary(torchLibrary,manifest),env={...process.env,
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
  writeFileSync(resolve(output),bytes,{flag:'wx'});
  return {length,sha256:createHash('sha256').update(bytes).digest('hex'),toolRevision:manifest.revision};
}
export async function writeMacroTrainingOrder({corpus,epoch,seed,output,torchLibrary,root=defaultRoot,directory,signal}){
  signal?.throwIfAborted();if(!corpus||!output||!torchLibrary)throw Error('Explicit macro corpus and training order inputs required');
  if(existsSync(output))throw Error('Training order output exists; preserve it');
  const dataset=await indexMacroTrainingDataset(corpus,{signal});
  const result=await writeBalancedTrainingOrder({datasets:[dataset.tiles.map(tile=>tile.duplicateGroup)],epoch,seed,output,torchLibrary,root,directory,signal});
  const corpusHash=createHash('sha256').update(readTrainingBounded(resolve(corpus),32*1024*1024)).digest('hex');
  if(corpusHash!==dataset.corpusSha256)throw Error('Training corpus changed during order preparation; preserve the output');
  return {...result,corpusSha256:dataset.corpusSha256,trainingOnly:true,releaseApproved:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{corpus:{type:'string'},epoch:{type:'string'},seed:{type:'string'},
    output:{type:'string'},'torch-library':{type:'string'}}});
    if(positionals.length||!/^\d+$/.test(values.epoch||'')||!/^\d+$/.test(values.seed||''))throw Error('Explicit macro corpus, epoch, seed and output required');
    console.log(JSON.stringify(await writeMacroTrainingOrder({corpus:values.corpus,epoch:Number(values.epoch),seed:Number(values.seed),
      output:values.output,torchLibrary:values['torch-library']})));
  }catch(error){console.error('training-order: '+error.message);process.exitCode=1;}
}
