// Validate independently reviewed originals; derived training labels are not truth.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,realpath,stat} from 'node:fs/promises';
import {dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {reportArgument} from '../report-paths.mjs';
import {validateReviewedAnnotation} from './review-masks.mjs';
import {validateSourceLanguage} from './source-language.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';

const SHA=/^[a-f0-9]{64}$/;
async function hashFile(path,signal){const hash=createHash('sha256');for await(const chunk of createReadStream(path,{signal}))hash.update(chunk);return hash.digest('hex');}
export function evaluationGroups(sheets){const groups={};for(const sheet of sheets){const key=[sheet.mapKind,sheet.script,sheet.language].join('/');(groups[key]??=[]).push(sheet.id);}return groups;}
export async function validatePublisherProvenance(annotation,sheet,root,{rendererVersion,signal}={}){
  signal?.throwIfAborted();
  if(annotation?.reviewed!==false||annotation.schemaVersion!==1)throw Error('Publisher-derived training labels cannot claim human review');
  const script=await readFile(fileURLToPath(new URL('./publisher.py',import.meta.url)),{signal});
  const scriptHash=createHash('sha256').update(Buffer.from(script.toString('utf8').replaceAll('\r\n','\n'))).digest('hex');
  const producer=annotation.producer,expected={script:'tools/reference-analysis/publisher.py',sha256:scriptHash,renderer:'PyMuPDF',rendererVersion};
  if(!producer||typeof producer!=='object'||Array.isArray(producer)||typeof rendererVersion!=='string'||!rendererVersion||
    Object.keys(producer).length!==4||Object.keys(expected).some(key=>producer[key]!==expected[key]))throw Error('Publisher label generator identity differs');
  const source=await resolveCorpusPath(root,annotation.sourcePdf),metadataPath=await resolveCorpusPath(root,annotation.sourceMetadata);
  if(await hashFile(source,signal)!==annotation.sourceSha256)throw Error('Publisher source hash changed');
  const metadataBytes=await readFile(metadataPath,{signal});
  if(createHash('sha256').update(metadataBytes).digest('hex')!==annotation.sourceMetadataSha256)throw Error('Publisher source metadata hash changed');
  const metadata=JSON.parse(metadataBytes.toString('utf8'));
  const license=metadata.license,hasLicense=!!license&&(!Array.isArray(license)||license.length>0)&&
    (typeof license!=='object'||Array.isArray(license)||Object.keys(license).length>0);
  if(metadata.sha256!==annotation.sourceSha256||metadata.rightsReviewed!==true||metadata.materialKind!=='publisher-layered-pdf'||!hasLicense||
    metadata.id!==sheet.id||metadata.familyId!==sheet.familyId||metadata.url!==sheet.source.url)throw Error('Verified publisher source provenance required');
}
// Shared metadata validation for reviewed corpora and explicitly private training corpora.
export function validateCorpusMetadata(value,{trainingOnly=false}={}){
  if(!value||value.schemaVersion!==1||!Array.isArray(value.sheets))throw Error('Corpus schemaVersion=1 and sheets are required');
  if(trainingOnly&&value.trainingOnly!==true)throw Error('Explicit materialized training-only corpus required');
  if(!trainingOnly&&value.trainingOnly)throw Error('Source-reviewed independent corpus required; supplied corpus is training-only');
  const seen=new Set(),splits=new Map();
  for(const sheet of value.sheets){
    if(!sheet?.id||seen.has(sheet.id))throw Error('Unique sheet id required');seen.add(sheet.id);
    if(!['train','validation','test'].includes(sheet.split))throw Error('Explicit train/validation/test split required');
    if(trainingOnly&&sheet.split!=='train')throw Error('Publisher training-only data cannot become validation/test truth');
    for(const key of ['familyId','editionId','duplicateGroup']){const group=sheet[key];if(!group)throw Error(key+' required');
      const identity=JSON.stringify([key,group]),previous=splits.get(identity);if(previous!==undefined&&previous!==sheet.split)throw Error(key+' crosses split boundaries');splits.set(identity,sheet.split);}
    if(!sheet.annotations)throw Error('Reviewed annotations required; unlabelled sources are inventory only');
    if(typeof sheet.sha256!=='string'||!SHA.test(sheet.sha256))throw Error('Original image sha256 required');
    validateSourceLanguage(sheet);if(!['color','monochrome'].includes(sheet.mapKind))throw Error('mapKind must be color or monochrome');
    if(!sheet.source?.url||!sheet.source?.license)throw Error('Source URL and license required');
    for(const key of ['image','annotations']){const path=sheet[key];
      if(typeof path!=='string'||!path||isAbsolute(path)||path.includes('\\')||path.split('/').includes('..'))throw Error('Corpus paths must stay inside corpus root');}
  }
  return value;
}
export async function validateReviewedCorpus(value,root,{signal,workspace,reviewDirectory,onVerified}={}){
  validateCorpusMetadata(value);
  if(onVerified!==undefined&&typeof onVerified!=='function')throw Error('Invalid verified source consumer');
  const base=await realpath(resolve(root));
  for(const sheet of value.sheets){
    signal?.throwIfAborted();
    const image=await resolveCorpusPath(base,sheet.image),annotationPath=await resolveCorpusPath(base,sheet.annotations);
    if(await hashFile(image,signal)!==sheet.sha256)throw Error('Original image hash changed: '+sheet.id);
    const info=await stat(annotationPath);if(!info.isFile()||info.size>64*1024*1024)throw Error('Annotation exceeds its byte budget');
    const annotationBytes=await readFile(annotationPath,{signal});if(annotationBytes.length>64*1024*1024)throw Error('Annotation exceeds its byte budget');
    const annotation=JSON.parse(annotationBytes.toString('utf8'));
    if(['publisher-layer-export','semap-human-mask-export','macro-vector-supervision'].includes(annotation.origin))
      throw Error('Derived training labels cannot become independent review truth');
    await validateReviewedAnnotation(annotation,sheet,{signal,workspace,directory:reviewDirectory});
    if(onVerified)await onVerified({sheet,annotation,annotationPath,annotationSha256:createHash('sha256').update(annotationBytes).digest('hex'),imagePath:image});
  }
  return value;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length===3&&['--metadata-stream','--groups-stream','--publisher-provenance-stream'].includes(process.argv[2])){
      const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>32*1024*1024)throw Error('Corpus metadata exceeds byte budget');chunks.push(chunk);}
      const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
      if(process.argv[2]==='--groups-stream'){
        if(!Array.isArray(request)||request.some(sheet=>!sheet||!['id','mapKind','script','language'].every(key=>typeof sheet[key]==='string'&&sheet[key])))throw Error('Explicit evaluation group fields required');
        console.log(JSON.stringify(evaluationGroups(request)));
      }else if(process.argv[2]==='--publisher-provenance-stream'){
        await validatePublisherProvenance(request.annotation,request.sheet,request.root,{rendererVersion:request.rendererVersion});console.log(JSON.stringify({valid:true}));
      }else{
        if(!request||typeof request.trainingOnly!=='boolean')throw Error('Explicit corpus training scope required');
        validateCorpusMetadata(request.value,{trainingOnly:request.trainingOnly});console.log(JSON.stringify({valid:true}));
      }
    }else{const {values,positionals}=parseArgs({allowPositionals:true,options:{corpus:{type:'string'}}});
    if(positionals.length||!values.corpus)throw Error('Usage: node tools/reference-analysis/reviewed-corpus.mjs --corpus MANIFEST');
    const path=resolve(reportArgument(values.corpus,{access:'read',siblings:true})),value=JSON.parse(await readFile(path,'utf8'));
    const result=await validateReviewedCorpus(value,dirname(path));console.log(JSON.stringify({valid:true,groups:evaluationGroups(result.sheets)}));
    }
  }catch(error){console.error('reviewed-corpus: '+error.message);process.exitCode=1;}
}
