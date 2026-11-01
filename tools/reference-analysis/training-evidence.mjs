import {createHash} from 'node:crypto';
import {closeSync,fstatSync,openSync,readFileSync,readSync,statSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
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
export function assertPublicEncoderIdentity(value){
  const match=typeof value?.url==='string'?/^https:\/\/download\.pytorch\.org\/models\/[^/]+-([a-f0-9]{8})\.pth$/.exec(value.url):null;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||value.kind!=='public-pretrained-image-classification'||
    !match||!/^[a-f0-9]{64}$/.test(value.sha256||'')||!value.sha256.startsWith(match[1])||!Number.isSafeInteger(value.bytes)||value.bytes<1)
    throw Error('Public encoder provenance required');
  return value;
}

// A fresh public encoder and a continued private model are different starts;
// both still begin without optimizer state and require source-bound receipts.
// This one-time extracted initializer was checked tensor-by-tensor against the
// official encoder. Binding both digests prevents an arbitrary full model from
// being presented as that verified extraction merely by changing its receipt.
const publicEncoderSourceSha256='5c1a416349c4cf298f2a6a5e2600ed0ee55e604713578f5e74e6bc8bcaef7997';
const publicEncoderWeightsSha256='f61c06441b2b83191a7fdf522467b547c3d60660122ffa07234695c6d38633e5';
export function verifyTrainingInitializer({path,expectedSha256}){
  if(typeof path!=='string'||!path)throw Error('Explicit training initializer required');
  const actual=resolve(path),weightsSha256=trainingFileIdentity(actual),recordPath=resolve(dirname(actual),'transfer.json');
  const recordBytes=readTrainingBounded(recordPath,1024*1024),recordHash=createHash('sha256').update(recordBytes).digest('hex'),record=JSON.parse(recordBytes);
  if(expectedSha256!==undefined&&expectedSha256!==weightsSha256||record.trainingOnly!==true||record.evaluationStatus!=='pending'||
    record.releaseApproved!==false||record.weightsSha256!==weightsSha256||!['weights-only-no-optimizer','public-encoder-no-optimizer'].includes(record.transfer))
    throw Error('Verified private weights-only initializer required');
  let encoderInitialization=null,sourceCheckpointSha256=record.sourceCheckpointSha256??null;
  if(sourceCheckpointSha256!==null&&!/^[a-f0-9]{64}$/.test(sourceCheckpointSha256))throw Error('Invalid initializer source checkpoint identity');
  if(record.sourceInitializationSha256!=null&&!/^[a-f0-9]{64}$/.test(record.sourceInitializationSha256))
    throw Error('Invalid source initialization checkpoint identity');
  if(record.transfer==='public-encoder-no-optimizer'){
    if(record.schemaVersion!==1||sourceCheckpointSha256!==null||record.tensorCount!==340||record.randomSeed!==20261022||
      weightsSha256!==publicEncoderWeightsSha256||record.encoderInitialization?.sha256!==publicEncoderSourceSha256||
      typeof record.encoderSourcePath!=='string'||!record.encoderSourcePath||!record.encoderInitialization)
      throw Error('Verified public encoder initializer receipt required');
    assertPublicEncoderIdentity(record.encoderInitialization);
    encoderInitialization=verifiedPublicEncoderIdentity({path:record.encoderSourcePath,url:record.encoderInitialization.url});
    if(!isDeepStrictEqual(encoderInitialization,record.encoderInitialization))throw Error('Public encoder initializer source differs');
  }
  if(trainingFileIdentity(actual)!==weightsSha256||createHash('sha256').update(readTrainingBounded(recordPath,1024*1024)).digest('hex')!==recordHash)
    throw Error('Training initializer changed during verification');
  return {initialization:record.transfer,sourceCheckpointSha256,encoderInitialization,weightsSha256,recordPath,recordHash};
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
