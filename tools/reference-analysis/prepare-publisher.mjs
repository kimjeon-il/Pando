// Materialize publisher-derived training inputs in the external library only.
// This does not create reviewed truth or approve a model.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,extname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {reportArgument} from '../report-paths.mjs';
import {encodeNativeGrayPng} from '../map-image/native-resample.mjs';
import {derivePublisherPdfTrainingLayers,encodePublisherRgbJpeg} from './native-publisher-pdf.mjs';
import {validatePublisherTrainingSource} from './training-tiles.mjs';
import {readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';

const projectRoot=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const worktreeRoots=execFileSync('git',['-c','core.quotepath=false','worktree','list','--porcelain'],{cwd:projectRoot,encoding:'utf8'})
  .split(/\r?\n/).filter(line=>line.startsWith('worktree ')).map(line=>realpathSync(line.slice(9)));
const producerPath=fileURLToPath(import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const channels=Object.freeze(['international','administrative','coast','hydro','transport','text','frame']);
const within=(root,path)=>{const part=relative(root,path);return part===''||(!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep));};
const normalizedSource=()=>Buffer.from(readFileSync(producerPath,'utf8').replaceAll('\r\n','\n'));
function directory(root,name){
  const path=join(root,name);
  if(existsSync(path)){const info=lstatSync(path);if(info.isSymbolicLink()||!info.isDirectory()||!within(root,realpathSync(path)))
    throw Error('Publisher output directory must be a real directory inside the corpus');}
  else mkdirSync(path);
  return path;
}
function existing(path){
  if(!existsSync(path))return null;
  const item=lstatSync(path);if(item.isSymbolicLink()||!item.isFile()||item.size>300*1024*1024)throw Error('Existing publisher output is not a bounded regular file');
  return readFileSync(path);
}
function producer(){return {script:'tools/reference-analysis/prepare-publisher.mjs',sha256:sha(normalizedSource()),renderer:'MuPDF',rendererVersion:'1.26.11'};}

export async function preparePublisherSheet({source,root,maximumDimension=2560,signal},{workspace=projectRoot,pdfDirectory,imageDirectory}={}){
  signal?.throwIfAborted();
  if(typeof root!=='string'||!root||typeof source!=='string'||!source||!Number.isSafeInteger(maximumDimension)||maximumDimension<32||maximumDimension>4096)
    throw Error('Explicit publisher source, corpus root and bounded dimension required');
  const base=realpathSync(resolve(root));if(worktreeRoots.some(worktree=>within(worktree,base)))throw Error('Publisher materials belong in external library storage');
  const pdf=realpathSync(resolve(source));if(!within(base,pdf)||extname(pdf).toLowerCase()!=='.pdf')throw Error('Publisher PDF must remain inside corpus root');
  const sourcePdf=relative(base,pdf).split(sep).join('/'),sourceMetadata=sourcePdf.slice(0,-4)+'.source.json';
  const metadataPath=await resolveCorpusPath(base,sourceMetadata),metadataBytes=readTrainingBounded(metadataPath,8*1024*1024),metadata=JSON.parse(metadataBytes);
  const sourceSha256=trainingFileIdentity(pdf,{maxBytes:300*1024*1024}),sourceMetadataSha256=sha(metadataBytes),key=metadata.id;
  if(typeof key!=='string'||!/^[a-z0-9][a-z0-9-]*$/.test(key)||metadata.format!=='pdf'||metadata.materialKind!=='publisher-layered-pdf'||
    metadata.rightsReviewed!==true||typeof metadata.license!=='string'||!metadata.license||typeof metadata.url!=='string'||!metadata.url||metadata.sha256!==sourceSha256)
    throw Error('Verified acquired publisher PDF and provenance required');
  const names={image:`derived/${key}.jpg`,raster:`derived/${key}.mask.png`,validRaster:`derived/${key}.valid.png`,annotations:`labels/${key}.json`,notice:`notices/${key}.txt`};
  const paths=Object.fromEntries(Object.entries(names).map(([name,path])=>[name,join(base,...path.split('/'))]));
  for(const folder of ['derived','labels','notices'])if(existsSync(join(base,folder)))directory(base,folder);
  const old=Object.fromEntries(Object.entries(paths).map(([name,path])=>[name,existing(path)]));
  if(Object.values(old).some(value=>value!==null)){
    if(Object.values(old).some(value=>value===null))throw Error('Incomplete existing publisher outputs; preserve for inspection');
    const annotation=JSON.parse(old.annotations),sheet=annotation.sheet;
    if(annotation.maximumDimension!==maximumDimension||annotation.sourcePdf!==sourcePdf||annotation.sourceSha256!==sourceSha256||
      annotation.sourceMetadata!==sourceMetadata||annotation.sourceMetadataSha256!==sourceMetadataSha256)
      throw Error('Existing publisher render identity differs; preserve for inspection');
    await validatePublisherTrainingSource({root:base,corpus:{schemaVersion:1,trainingOnly:true,sheets:[sheet]},sourceId:key},{signal,workspace,imageDirectory});
    return sheet;
  }
  const identity=producer();
  const derived=await derivePublisherPdfTrainingLayers({path:pdf,maximumDimension},{signal,workspace,directory:pdfDirectory});
  const image=await encodePublisherRgbJpeg(derived,{signal,workspace,directory:pdfDirectory,imageDirectory});
  const raster=await encodeNativeGrayPng({width:derived.width,height:derived.height,data:derived.mask},{signal,workspace,directory:imageDirectory});
  const validRaster=await encodeNativeGrayPng({width:derived.width,height:derived.height,data:derived.validMask},{signal,workspace,directory:imageDirectory});
  if(derived.sourceSha256!==sourceSha256||trainingFileIdentity(pdf,{maxBytes:300*1024*1024})!==sourceSha256||
    sha(readTrainingBounded(metadataPath,8*1024*1024))!==sourceMetadataSha256||!isDeepStrictEqual(producer(),identity))
    throw Error('Publisher source or generator changed during derivation');
  const sheet={id:key,familyId:metadata.familyId,editionId:metadata.editionId,duplicateGroup:key,split:'train',image:names.image,
    annotations:names.annotations,mapKind:'color',language:metadata.language,script:metadata.script,
    source:Object.fromEntries(['url','metadataUrl','license','rightsUrl','published'].map(name=>[name,metadata[name]??null])),sha256:sha(image)};
  const observedChannels=channels.filter((_,index)=>derived.observedMask&(1<<index));
  const annotation={schemaVersion:1,reviewed:false,origin:'publisher-layer-export',width:derived.width,height:derived.height,maximumDimension,
    observedChannels,sourcePdf,sourceSha256,sourceMetadata,sourceMetadataSha256,producer:identity,sourceRectPts:derived.sourceRectPts,pixelsPerPoint:derived.scale,
    layers:derived.layers,disabledInputLayers:['Orthoimage','Shaded Relief'],positivePixels:Object.fromEntries(channels.map((name,index)=>[name,derived.positivePixels[index]])),
    raster:{path:names.raster,sha256:sha(raster)},validRaster:{path:names.validRaster,sha256:sha(validRaster)},sheet};
  const credits=new TextDecoder('utf-8',{fatal:true}).decode(derived.credits);
  const payload={image,raster,validRaster,notice:Buffer.from(`${metadata.url}\n${metadata.license}\n\nPublisher text / credits:\n${credits}`),
    annotations:Buffer.from(JSON.stringify(annotation,null,2)+'\n')};
  const created=[];
  try{
    for(const folder of ['derived','labels','notices'])directory(base,folder);
    for(const name of ['image','raster','validRaster','notice','annotations']){
      signal?.throwIfAborted();writeFileSync(paths[name],payload[name],{flag:'wx'});created.push({path:paths[name],sha256:sha(payload[name])});
    }
    await validatePublisherTrainingSource({root:base,corpus:{schemaVersion:1,trainingOnly:true,sheets:[sheet]},sourceId:key},{signal,workspace,imageDirectory});
    return sheet;
  }catch(error){
    for(const item of created.reverse()){try{const info=lstatSync(item.path);
      if(info.isFile()&&!info.isSymbolicLink()&&within(base,realpathSync(item.path))&&trainingFileIdentity(item.path)===item.sha256)unlinkSync(item.path);
    }catch{/* Preserve uncertain outputs for inspection. */}}
    throw error;
  }
}

export async function preparePublisherCorpus({sources,maximumDimension=2560,signal},options={}){
  signal?.throwIfAborted();if(typeof sources!=='string'||!sources)throw Error('Explicit publisher sources directory required');
  const sourceRoot=realpathSync(resolve(sources)),base=realpathSync(dirname(sourceRoot));
  if(worktreeRoots.some(worktree=>within(worktree,base)))throw Error('Publisher materials belong in external library storage');
  const files=readdirSync(sourceRoot,{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name.toLowerCase().endsWith('.pdf')).map(entry=>entry.name).sort();
  if(!files.length)throw Error('Acquired publisher PDFs required');
  const sheets=[];for(const name of files)sheets.push(await preparePublisherSheet({source:join(sourceRoot,name),root:base,maximumDimension,signal},options));
  const manifest=join(base,'corpus.training.json'),value={schemaVersion:1,trainingOnly:true,sheets},old=existing(manifest);
  if(old){if(!isDeepStrictEqual(JSON.parse(old),value))throw Error('Existing training corpus differs; preserve for inspection');}
  else writeFileSync(manifest,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  return {manifest,sheets:sheets.length,trainingOnly:true,independentEvaluation:false,releaseApproved:false};
}

if(process.argv[1]&&resolve(process.argv[1])===producerPath){
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{sources:{type:'string'},'maximum-dimension':{type:'string'}}});
    if(positionals.length||!values.sources)throw Error('Explicit publisher sources required');
    const maximumDimension=values['maximum-dimension']===undefined?2560:Number(values['maximum-dimension']);
    const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
    try{console.log(JSON.stringify(await preparePublisherCorpus({sources:reportArgument(values.sources,{access:'write'}),maximumDimension,signal:controller.signal})));}
    finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
  }catch(error){console.error('prepare-publisher: '+error.message);process.exitCode=1;}
}
