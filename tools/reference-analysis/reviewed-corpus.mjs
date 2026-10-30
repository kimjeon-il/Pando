// Validate independently reviewed originals; derived training labels are not truth.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {reportArgument} from '../report-paths.mjs';
import {validateReviewedAnnotation} from './review-masks.mjs';
import {validateSourceLanguage} from './source-language.mjs';

const SHA=/^[a-f0-9]{64}$/;
async function corpusPath(root,path){
  if(typeof path!=='string'||!path||path.startsWith('/')||path.split('/').includes('..'))throw Error('Corpus paths must stay inside corpus root');
  const result=await realpath(resolve(root,path)),rel=relative(root,result);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('Corpus symlink escapes root');return result;
}
async function hashFile(path,signal){const hash=createHash('sha256');for await(const chunk of createReadStream(path,{signal}))hash.update(chunk);return hash.digest('hex');}
export function evaluationGroups(sheets){const groups={};for(const sheet of sheets){const key=[sheet.mapKind,sheet.script,sheet.language].join('/');(groups[key]??=[]).push(sheet.id);}return groups;}
export async function validateReviewedCorpus(value,root,{signal,workspace,reviewDirectory}={}){
  if(!value||value.schemaVersion!==1||!Array.isArray(value.sheets))throw Error('Corpus schemaVersion=1 and sheets are required');
  if(value.trainingOnly)throw Error('Source-reviewed independent corpus required; supplied corpus is training-only');
  const base=await realpath(resolve(root)),seen=new Set(),splits=new Map();
  for(const sheet of value.sheets){
    signal?.throwIfAborted();if(!sheet?.id||seen.has(sheet.id))throw Error('Unique sheet id required');seen.add(sheet.id);
    if(!['train','validation','test'].includes(sheet.split))throw Error('Explicit train/validation/test split required');
    for(const key of ['familyId','editionId','duplicateGroup']){const group=sheet[key];if(!group)throw Error(key+' required');
      const identity=JSON.stringify([key,group]),previous=splits.get(identity);if(previous!==undefined&&previous!==sheet.split)throw Error(key+' crosses split boundaries');splits.set(identity,sheet.split);}
    if(!sheet.annotations)throw Error('Reviewed annotations required; unlabelled sources are inventory only');
    if(typeof sheet.sha256!=='string'||!SHA.test(sheet.sha256))throw Error('Original image sha256 required');
    validateSourceLanguage(sheet);if(!['color','monochrome'].includes(sheet.mapKind))throw Error('mapKind must be color or monochrome');
    if(!sheet.source?.url||!sheet.source?.license)throw Error('Source URL and license required');
    const image=await corpusPath(base,sheet.image),annotationPath=await corpusPath(base,sheet.annotations);
    if(await hashFile(image,signal)!==sheet.sha256)throw Error('Original image hash changed: '+sheet.id);
    const annotation=JSON.parse(await readFile(annotationPath,{encoding:'utf8',signal}));
    if(['publisher-layer-export','semap-human-mask-export','macro-vector-supervision'].includes(annotation.origin))
      throw Error('Derived training labels cannot become independent review truth');
    await validateReviewedAnnotation(annotation,sheet,{signal,workspace,directory:reviewDirectory});
  }
  return value;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{corpus:{type:'string'}}});
    if(positionals.length||!values.corpus)throw Error('Usage: node tools/reference-analysis/reviewed-corpus.mjs --corpus MANIFEST');
    const path=resolve(reportArgument(values.corpus,{access:'read',siblings:true})),value=JSON.parse(await readFile(path,'utf8'));
    const result=await validateReviewedCorpus(value,dirname(path));console.log(JSON.stringify({valid:true,groups:evaluationGroups(result.sheets)}));
  }catch(error){console.error('reviewed-corpus: '+error.message);process.exitCode=1;}
}
