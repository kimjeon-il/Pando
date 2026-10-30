import {createHash} from 'node:crypto';
import {closeSync,fstatSync,openSync,readFileSync,readSync,statSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {resolveCorpusPath} from './corpus-path.mjs';

export function readTrainingBounded(path,limit){const info=statSync(path);if(!info.isFile()||info.size>limit)throw Error('Training input exceeds its byte budget');return readFileSync(path);}
export function trainingFileIdentity(path){const fd=openSync(path,'r');try{const before=fstatSync(fd);
  if(!before.isFile()||before.size>1024**3)throw Error('Expected bounded checkpoint or evidence file');
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let total=0,count;
  while((count=readSync(fd,buffer,0,buffer.length,null))>0){total+=count;hash.update(buffer.subarray(0,count));}
  const after=fstatSync(fd);if(total!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino||after.dev!==before.dev)
    throw Error('Checkpoint or evidence changed while hashing');return hash.digest('hex');
}finally{closeSync(fd);}}

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
    const actual=await resolveCorpusPath(root,relative);digest.update(`${relative}\n${trainingFileIdentity(actual)}\n`,'utf8');
  }
  return digest.digest('hex');
}
