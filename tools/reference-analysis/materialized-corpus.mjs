// Select the canonical validator for each materialized corpus source.
// Derived training labels never become independent review truth.
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveCorpusPath} from './corpus-path.mjs';
import {validateCorpusMetadata,validateReviewedCorpus} from './reviewed-corpus.mjs';
import {validateReviewedAnnotation} from './review-masks.mjs';
import {trainingFileIdentity} from './training-evidence.mjs';
import {validatePublisherTrainingSource} from './training-tiles.mjs';
import {validateMacroSheet} from './validate-macro.mjs';
import {validateSemapTrainingSheet} from './validate-semap.mjs';

export async function validateMaterializedCorpus(value,root,{trainingOnly=false,signal,workspace,reviewDirectory,imageDirectory,pdfDirectory,rendererVersion='1.26.6'}={}){
  validateCorpusMetadata(value,{trainingOnly});
  if(!root){if(trainingOnly)throw Error('Explicit materialized training-only corpus required');return value;}
  if(!trainingOnly)return validateReviewedCorpus(value,root,{signal,workspace,reviewDirectory});
  const base=await realpath(resolve(root));
  for(const sheet of value.sheets){
    signal?.throwIfAborted();const image=await resolveCorpusPath(base,sheet.image);
    if(trainingFileIdentity(image)!==sheet.sha256)throw Error('Original image hash changed: '+sheet.id);
    const path=await resolveCorpusPath(base,sheet.annotations),info=await stat(path);
    if(!info.isFile()||info.size>64*1024*1024)throw Error('Annotation exceeds its byte budget');
    const bytes=await readFile(path,{signal});if(bytes.length>64*1024*1024)throw Error('Annotation exceeds its byte budget');
    const annotation=JSON.parse(bytes.toString('utf8'));
    if(annotation.origin==='publisher-layer-export')
      await validatePublisherTrainingSource({root:base,corpus:{...value,sheets:[sheet]},sourceId:sheet.id},{signal,workspace,imageDirectory,rendererVersion});
    else if(annotation.origin==='semap-human-mask-export')
      await validateSemapTrainingSheet({root:base,sheet,annotation},{signal,workspace,imageDirectory});
    else if(annotation.origin==='macro-vector-supervision')
      await validateMacroSheet({root:base,sheet,annotation},{signal,workspace,imageDirectory,pdfDirectory});
    else await validateReviewedAnnotation(annotation,sheet,{signal,workspace,directory:reviewDirectory});
  }
  return value;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--stream')throw Error('Expected --stream');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>32*1024*1024)throw Error('Corpus request exceeds byte budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    if(!request||typeof request.trainingOnly!=='boolean'||request.root!==null&&typeof request.root!=='string')throw Error('Explicit corpus scope required');
    await validateMaterializedCorpus(request.value,request.root,{trainingOnly:request.trainingOnly,rendererVersion:request.rendererVersion});
    console.log(JSON.stringify({valid:true}));
  }catch(error){console.error('materialized-corpus: '+error.message);process.exitCode=1;}
}
