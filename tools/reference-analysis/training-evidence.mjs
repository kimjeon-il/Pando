import {createHash} from 'node:crypto';
import {closeSync,fstatSync,openSync,readFileSync,readSync,statSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveCorpusPath} from './corpus-path.mjs';

export function readTrainingBounded(path,limit){const info=statSync(path);if(!info.isFile()||info.size>limit)throw Error('Training input exceeds its byte budget');return readFileSync(path);}
export function assertTrainingCorpusScope(path){
  const manifest=JSON.parse(readTrainingBounded(resolve(path),32*1024*1024));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.sheets)||!manifest.sheets.length||manifest.sheets.some(sheet=>sheet?.split!=='train'))
    throw Error('Training corpus must contain only training sources');
  return manifest;
}
export function trainingFileIdentity(path,{maxBytes=1024**3}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid evidence byte budget');
  const fd=openSync(path,'r');try{const before=fstatSync(fd);
  if(!before.isFile()||before.size>maxBytes)throw Error('Expected bounded checkpoint or evidence file');
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let total=0,count;
  while((count=readSync(fd,buffer,0,buffer.length,null))>0){total+=count;hash.update(buffer.subarray(0,count));}
  const after=fstatSync(fd);if(total!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino||after.dev!==before.dev)
    throw Error('Checkpoint or evidence changed while hashing');return hash.digest('hex');
}finally{closeSync(fd);}}

// The official model filename pins the leading eight hex digits; retain the
// complete identity and byte count for the training receipt.
export function verifiedPublicEncoderIdentity({path,url}){
  const match=typeof url==='string'?/^https:\/\/download\.pytorch\.org\/models\/[^/]+-([a-f0-9]{8})\.pth$/.exec(url):null;
  if(typeof path!=='string'||!path||!match)throw Error('Pinned official public encoder URL required');
  const before=statSync(path),digest=trainingFileIdentity(path),after=statSync(path);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino||before.dev!==after.dev)
    throw Error('Public encoder weights changed while verifying');
  if(!digest.startsWith(match[1]))throw Error('Public encoder weight hash differs from the pinned upstream identifier');
  return {kind:'public-pretrained-image-classification',url,sha256:digest,bytes:after.size};
}

// Matches the original corpus lineage fingerprint; source validation remains a separate requirement.
export async function corpusFingerprint(manifest,auxiliary){
  if(!manifest)throw Error('Explicit corpus path required');
  if(auxiliary){const hashes=[await corpusFingerprint(manifest),await corpusFingerprint(auxiliary)];
    return createHash('sha256').update(JSON.stringify(hashes).replace(',',', ')).digest('hex');}
  const path=resolve(manifest),root=dirname(path),data=JSON.parse(readTrainingBounded(path,32*1024*1024));
  if(!Array.isArray(data.sheets))throw Error('Corpus sheets required');
  const files=new Set([basename(path)]),add=value=>{if(typeof value!=='string'||!value||!value.isWellFormed())throw Error('Corpus source path required');files.add(value);};
  for(const sheet of data.sheets){add(sheet?.image);add(sheet?.annotations);
    const annotation=JSON.parse(readTrainingBounded(await resolveCorpusPath(root,sheet.annotations),64*1024*1024));
    if(['publisher-layer-export','macro-vector-supervision'].includes(annotation.origin)){
      add(annotation.sourcePdf);add(annotation.sourceMetadata);add(annotation.raster?.path);add(annotation.validRaster?.path);
    }else if(annotation.origin==='semap-human-mask-export'){
      if(!Array.isArray(annotation.sourceFiles))throw Error('Corpus source evidence required');
      for(const source of annotation.sourceFiles)add(source?.path);add(annotation.raster?.path);add(annotation.validRaster?.path);
    }
  }
  // Python orders strings by Unicode code point, unlike JavaScript's UTF-16 ordering.
  const compare=(a,b)=>{const x=Array.from(a,c=>c.codePointAt(0)),y=Array.from(b,c=>c.codePointAt(0));
    for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
  const digest=createHash('sha256');for(const relative of [...files].sort(compare)){
    const actual=await resolveCorpusPath(root,relative);digest.update(`${relative}\n${trainingFileIdentity(actual,{maxBytes:Number.MAX_SAFE_INTEGER})}\n`,'utf8');
  }
  return digest.digest('hex');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||!['--fingerprint-stream','--encoder-identity-stream'].includes(process.argv[2]))throw Error('Expected training evidence stream operation');
    const chunks=[];let length=0;for await(const chunk of process.stdin){length+=chunk.length;
      if(length>1024*1024)throw Error('Corpus fingerprint request exceeds byte budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,length).toString('utf8'));
    if(process.argv[2]==='--encoder-identity-stream'){
      process.stdout.write(JSON.stringify(verifiedPublicEncoderIdentity(request))+'\n');
    }else{
    if(typeof request?.manifest!=='string'||!request.manifest||
      (request.auxiliary!==null&&request.auxiliary!==undefined&&(typeof request.auxiliary!=='string'||!request.auxiliary)))
      throw Error('Explicit corpus manifest paths required');
    process.stdout.write(JSON.stringify({fingerprint:await corpusFingerprint(request.manifest,request.auxiliary)})+'\n');
    }
  }catch(error){console.error('training-evidence: '+error.message);process.exitCode=1;}
}
