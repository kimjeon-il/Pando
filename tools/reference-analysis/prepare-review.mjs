// Prepare source-bound draft labels without copying or changing original maps.
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,readdir,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {REFERENCE_OCR_LANGUAGES} from '../../plugins/pando-map-tools/lib/analysis/ocr-catalog.mjs';
import {inspectNativeImageHeader} from '../map-image/native-resample.mjs';
import {reportArgument} from '../report-paths.mjs';

function inside(root,path){const rel=relative(root,path);return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));}
async function resolvedWithMissing(path){try{return await realpath(path);}catch(error){
  if(error.code!=='ENOENT')throw error;const parent=dirname(path);if(parent===path)throw error;
  return join(await resolvedWithMissing(parent),path.slice(parent.length+1));
}}
async function contained(root,path){const target=await resolvedWithMissing(path);if(!inside(root,target))throw Error('Review corpus path escape');return path;}
async function optionalJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function sourceLanguage(source){
  if(!/^[a-z]{3}(?:_[a-z0-9]+)*$/.test(source.language||'')||!source.script)throw Error('Explicit source language and script required');
  const packs=Object.hasOwn(source,'ocrLanguages')?source.ocrLanguages:[];if(!Array.isArray(packs)||new Set(packs).size!==packs.length||packs.some(pack=>!REFERENCE_OCR_LANGUAGES.includes(pack)))
    throw Error('OCR languages must refer to the installed runtime catalog');
}
async function writeNew(path,value,signal){const handle=await open(path,'wx');try{await handle.writeFile(JSON.stringify(value,null,2)+'\n',{encoding:'utf8',signal});}finally{await handle.close();}}
export async function prepareReviewCorpus(sourceDirectory,{signal,workspace,directory}={}){
  signal?.throwIfAborted();const sources=await realpath(resolve(sourceDirectory)),root=dirname(sources);
  const labelsDir=await contained(root,join(root,'labels')),manifest=await contained(root,join(root,'corpus.draft.json'));
  const names=(await readdir(sources)).filter(name=>name.endsWith('.source.json')).sort(),seen=new Set(),sheets=[],drafts=[];
  for(const name of names){
    signal?.throwIfAborted();const metadata=await contained(root,join(sources,name)),source=JSON.parse(await readFile(metadata,{encoding:'utf8',signal})),key=source.id||'';
    if(!/^[a-z0-9][a-z0-9_-]*$/.test(key)||seen.has(key))throw Error('Unique safe source id required');seen.add(key);
    const format=Object.hasOwn(source,'format')?source.format:'jpeg',suffix=({jpeg:'.jpg',png:'.png',webp:'.webp'})[format];
    if(!suffix)throw Error('Prepare an explicit bounded raster page for PDF corpus review');
    if(source.rightsReviewed!==true||!source.license||!source.url||!source.familyId)throw Error('Verified acquired source and provenance required');
    sourceLanguage(source);const image=await contained(root,join(sources,key+suffix)),bytes=await readFile(image,{signal});
    if(createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw Error('Original image hash changed: '+key);
    const header=await inspectNativeImageHeader(bytes,format,{signal,workspace,directory});
    const labels=await contained(root,join(labelsDir,key+'.json')),annotation={schemaVersion:1,reviewed:false,width:header.size[0],height:header.size[1],lines:[],ignore:[]};
    const existing=await optionalJson(labels);
    if(existing!==null){if(['schemaVersion','width','height'].some(field=>existing[field]!==annotation[field]))throw Error('Existing labels differ from source dimensions; preserve for inspection');}
    else drafts.push([labels,annotation]);
    const sourceFields={};for(const field of ['url','metadataUrl','license','surveyed','published','revised','materialKind','uncertainty'])sourceFields[field]=source[field]??null;
    sheets.push({id:key,familyId:source.familyId,editionId:null,duplicateGroup:key,split:null,image:relative(root,image).split(sep).join('/'),sha256:source.sha256,
      annotations:relative(root,labels).split(sep).join('/'),mapKind:null,language:source.language,script:source.script,ocrLanguages:source.ocrLanguages??[],source:sourceFields});
  }
  if(!sheets.length)throw Error('Verified acquired map sources required');
  const existing=await optionalJson(manifest);
  if(existing!==null){const old=existing.sheets,expected=new Map(sheets.map(row=>[row.id,row]));
    if(existing.schemaVersion!==1||!Array.isArray(old)||old.length!==sheets.length||new Set(old.map(row=>row.id)).size!==sheets.length||old.some(row=>!expected.has(row.id)))
      throw Error('Existing draft source inventory differs; preserve for inspection');
    for(const row of old)if(['image','sha256','annotations','familyId'].some(field=>row[field]!==expected.get(row.id)[field]))
      throw Error('Existing draft source identity differs; preserve for inspection');
  }
  signal?.throwIfAborted();await contained(root,labelsDir);await mkdir(labelsDir,{recursive:true});
  for(const [path,value] of drafts){signal?.throwIfAborted();await contained(root,path);await writeNew(path,value,signal);}
  if(existing===null){await contained(root,manifest);await writeNew(manifest,{schemaVersion:1,trainingReady:false,sheets},signal);}
  return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{sources:{type:'string'}}});
    if(positionals.length||!values.sources)throw Error('Usage: node tools/reference-analysis/prepare-review.mjs --sources EXTERNAL_SOURCE_DIRECTORY');
    const source=await realpath(resolve(reportArgument(values.sources,{access:'write'}))),repo=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
    if(inside(repo,source))throw Error('Review materials belong to external library storage');
    console.log(await prepareReviewCorpus(source));
  }catch(error){console.error('prepare-review: '+error.message);process.exitCode=1;}
}
