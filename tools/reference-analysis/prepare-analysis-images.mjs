#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {link,lstat,open,readFile,readdir,realpath,stat,unlink,writeFile} from 'node:fs/promises';
import {basename,dirname,extname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {inspectNativeJpeg,prepareNativeJpeg} from '../map-image/native-resample.mjs';
import {reportArgument} from '../report-paths.mjs';

const workspace=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
async function sourceHashAfterPreparation(path,signal){const hash=createHash('sha256');
  for await(const chunk of createReadStream(path,{signal:signal||undefined}))hash.update(chunk);return hash.digest('hex');}
async function exists(path){try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function removeOwned(path,identity){
  let current;try{current=await lstat(path);}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(!identity||!current.isFile()||current.dev!==identity.dev||current.ino!==identity.ino)throw Error('Temporary output identity changed; preserve it for inspection: '+path);
  await unlink(path);
}

export async function prepareAnalysisImage(value,{maximumPixels=8000000,signal,allowCreate=true}={}){
  signal?.throwIfAborted();const path=resolve(value),suffix=extname(path),stem=path.slice(0,-suffix.length);
  if(suffix.toLowerCase()!=='.jpg')throw Error('Current acquired JPEG source required');
  if(!Number.isInteger(maximumPixels)||maximumPixels<1||maximumPixels>16777216)throw Error('Positive pixel budget up to 16MP required');
  const metadata=JSON.parse(await readFile(stem+'.source.json','utf8'));
  const info=await stat(path);if(!info.isFile()||info.size>300*1024*1024)throw Error('JPEG source exceeds encoded byte budget');
  const bytes=await readFile(path,{signal:signal||undefined}),sourceHash=sha256(bytes);
  if(metadata.rightsReviewed!==true||metadata.sha256!==sourceHash||typeof metadata.id!=='string'||typeof metadata.familyId!=='string')
    throw Error('Verified acquired source and provenance required');
  const originalSize=await inspectNativeJpeg(bytes,{signal,workspace});
  const common={sourceId:metadata.id,familyId:metadata.familyId,sourceSha256:sourceHash,originalSize,
    reviewedLabels:false,purpose:'app-runtime-input-only'};
  if(originalSize[0]*originalSize[1]<=maximumPixels)return {...common,path:basename(path),size:originalSize,originalPixelsPerInputPixel:[1,1],sha256:sourceHash};
  const target=stem+'-analysis.jpg',evidence=stem+'-analysis.json',temporary=target+'.part';
  if(await exists(target)||await exists(evidence)){
    if(!(await exists(target))||!(await exists(evidence)))throw Error('Incomplete existing app input; preserve for inspection');
    const saved=JSON.parse(await readFile(evidence,'utf8')),existingBytes=await readFile(target,{signal:signal||undefined});
    const actualSize=await inspectNativeJpeg(existingBytes,{signal,workspace});
    if(saved.sourceId!==metadata.id||saved.familyId!==metadata.familyId||saved.sourceSha256!==sourceHash||saved.path!==basename(target)||
       saved.sha256!==sha256(existingBytes)||!Array.isArray(saved.originalSize)||saved.originalSize.length!==2||
       saved.originalSize.some((value,index)=>value!==originalSize[index])||!Array.isArray(saved.size)||saved.size.length!==2||
       saved.size.some((value,index)=>!Number.isInteger(value)||value<1||value!==actualSize[index])||saved.size[0]*saved.size[1]>maximumPixels||
       !Array.isArray(saved.originalPixelsPerInputPixel)||saved.originalPixelsPerInputPixel.length!==2||
       saved.originalPixelsPerInputPixel.some((value,index)=>value!==originalSize[index]/saved.size[index])||
       saved.reviewedLabels!==false||saved.purpose!=='app-runtime-input-only')
      throw Error('Existing app input differs; preserve for inspection');
    return saved;
  }
  if(!allowCreate)throw Error('Existing input manifest requires an uncreated derivative; preserve it for inspection');
  const result=await prepareNativeJpeg(bytes,maximumPixels,{signal,workspace});
  if(!result.changed||result.originalSize.some((value,index)=>value!==originalSize[index]))throw Error('JPEG preparation identity changed');
  if(await sourceHashAfterPreparation(path,signal)!==sourceHash)throw Error('Original JPEG changed during preparation');
  const output={...common,path:basename(target),size:result.size,
    originalPixelsPerInputPixel:[result.originalSize[0]/result.size[0],result.originalSize[1]/result.size[1]],sha256:sha256(result.data)};
  let temporaryIdentity=null,evidenceIdentity=null,published=false;
  try{
    const file=await open(temporary,'wx');
    try{temporaryIdentity=await file.stat();await file.writeFile(result.data,{signal:signal||undefined});}finally{await file.close();}
    signal?.throwIfAborted();const receipt=await open(evidence,'wx');
    try{evidenceIdentity=await receipt.stat();await receipt.writeFile(JSON.stringify(output,null,2)+'\n',{signal:signal||undefined});}finally{await receipt.close();}
    signal?.throwIfAborted();await link(temporary,target);published=true;
    return output;
  }finally{
    if(temporaryIdentity)await removeOwned(temporary,temporaryIdentity);
    if(evidenceIdentity&&!published)await removeOwned(evidence,evidenceIdentity);
  }
}

async function main(){
  const {values}=parseArgs({options:{sources:{type:'string'}}});if(!values.sources)throw Error('--sources is required');
  const directory=await realpath(resolve(reportArgument(values.sources,{access:'write'}))),repo=await realpath(workspace),rel=relative(repo,directory);
  if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))throw Error('App input derivatives belong to external material storage');
  const controller=new AbortController(),abort=()=>controller.abort(new Error('Image preparation cancelled'));
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    const manifest=join(directory,'analysis-inputs.json'),alreadyExists=await exists(manifest),inputs=[];
    for(const name of (await readdir(directory)).filter(name=>name.endsWith('.jpg')&&!name.endsWith('-analysis.jpg')).sort())
      inputs.push(await prepareAnalysisImage(join(directory,name),{signal:controller.signal,allowCreate:!alreadyExists}));
    const value={schemaVersion:1,inputs,trainingReady:false},content=JSON.stringify(value,null,2)+'\n';
    if(alreadyExists){if(!isDeepStrictEqual(JSON.parse(await readFile(manifest,'utf8')),value))throw Error('Existing input manifest differs; preserve it for inspection');}
    else await writeFile(manifest,content,{flag:'wx',signal:controller.signal});
    console.log(JSON.stringify(inputs));
  }finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
