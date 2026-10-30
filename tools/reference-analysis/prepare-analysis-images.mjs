#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {link,open,readFile,readdir,realpath,stat,unlink,writeFile} from 'node:fs/promises';
import {basename,dirname,extname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {inspectNativeJpeg,prepareNativeJpeg} from '../map-image/native-resample.mjs';
import {reportArgument} from '../report-paths.mjs';

const workspace=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
async function sourceHashAfterPreparation(path,signal){const hash=createHash('sha256');
  for await(const chunk of createReadStream(path,{signal:signal||undefined}))hash.update(chunk);return hash.digest('hex');}
async function exists(path){try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

export async function prepareAnalysisImage(value,{maximumPixels=8000000,signal}={}){
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
    const saved=JSON.parse(await readFile(evidence,'utf8'));
    if(saved.sourceSha256!==sourceHash||saved.sha256!==sha256(await readFile(target))||!Array.isArray(saved.size)||saved.size[0]*saved.size[1]>maximumPixels)
      throw Error('Existing app input differs; preserve for inspection');
    return saved;
  }
  const result=await prepareNativeJpeg(bytes,maximumPixels,{signal,workspace});
  if(!result.changed||result.originalSize.some((value,index)=>value!==originalSize[index]))throw Error('JPEG preparation identity changed');
  if(await sourceHashAfterPreparation(path,signal)!==sourceHash)throw Error('Original JPEG changed during preparation');
  const output={...common,path:basename(target),size:result.size,
    originalPixelsPerInputPixel:[result.originalSize[0]/result.size[0],result.originalSize[1]/result.size[1]],sha256:sha256(result.data)};
  let createdTemporary=false,createdEvidence=false,published=false;
  try{
    const file=await open(temporary,'wx');createdTemporary=true;
    try{await file.writeFile(result.data,{signal:signal||undefined});}finally{await file.close();}
    signal?.throwIfAborted();const receipt=await open(evidence,'wx');createdEvidence=true;
    try{await receipt.writeFile(JSON.stringify(output,null,2)+'\n',{signal:signal||undefined});}finally{await receipt.close();}
    signal?.throwIfAborted();await link(temporary,target);published=true;
    return output;
  }finally{
    if(createdTemporary)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(createdEvidence&&!published)await unlink(evidence).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}

async function main(){
  const {values}=parseArgs({options:{sources:{type:'string'}}});if(!values.sources)throw Error('--sources is required');
  const directory=await realpath(resolve(reportArgument(values.sources,{access:'write'}))),repo=await realpath(workspace),rel=relative(repo,directory);
  if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))throw Error('App input derivatives belong to external material storage');
  const controller=new AbortController(),abort=()=>controller.abort(new Error('Image preparation cancelled'));
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    const inputs=[];for(const name of (await readdir(directory)).filter(name=>name.endsWith('.jpg')&&!name.endsWith('-analysis.jpg')).sort())
      inputs.push(await prepareAnalysisImage(join(directory,name),{signal:controller.signal}));
    const manifest=join(directory,'analysis-inputs.json'),content=JSON.stringify({schemaVersion:1,inputs,trainingReady:false},null,2)+'\n';
    try{await writeFile(manifest,content,{flag:'wx',signal:controller.signal});}
    catch(error){if(error.code!=='EEXIST'||await readFile(manifest,'utf8')!==content)throw error;}
    console.log(JSON.stringify(inputs));
  }finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
