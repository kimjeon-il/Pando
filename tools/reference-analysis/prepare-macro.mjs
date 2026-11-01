// Materialize weak macro supervision only in external, source-bound storage.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,extname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {encodeNativeGrayPng} from '../map-image/native-resample.mjs';
import {reportArgument} from '../report-paths.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';
import {deriveMacroPdf} from './native-macro-pdf.mjs';
import {encodePublisherRgbJpeg} from './native-publisher-pdf.mjs';
import {readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';
import {validateMacroSheet} from './validate-macro.mjs';
import {validateCorpusMetadata} from './reviewed-corpus.mjs';

// Windows runners may expose the temporary root via an 8.3 alias. The native
// resolver expands both roots and children to the same final path spelling.
const realpath=realpathSync.native;
const projectRoot=realpath(fileURLToPath(new URL('../../',import.meta.url))),script=fileURLToPath(import.meta.url);
const worktrees=execFileSync('git',['-c','core.quotepath=false','worktree','list','--porcelain'],{cwd:projectRoot,encoding:'utf8'})
  .split(/\r?\n/).filter(line=>line.startsWith('worktree ')).map(line=>realpath(line.slice(9)));
const sha=value=>createHash('sha256').update(value).digest('hex'),sourceHash=()=>sha(Buffer.from(readFileSync(script,'utf8').replaceAll('\r\n','\n')));
const channels=['international','administrative','coast','hydro','transport','text','frame'];
const within=(root,path)=>{const r=relative(root,path);return !isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+sep);};
const normal=path=>path.split(sep).join('/');
function regular(path){if(!existsSync(path))return null;const info=lstatSync(path);
  if(info.isSymbolicLink()||!info.isFile()||info.size>300*1024*1024)throw Error('Existing macro output must be a bounded regular file');return readFileSync(path);}
function folder(base,name){const path=join(base,name);if(existsSync(path)){const info=lstatSync(path);
  if(info.isSymbolicLink()||!info.isDirectory()||!within(base,realpath(path)))throw Error('Macro output directory must remain inside the corpus');}
  else mkdirSync(path);}
function sheetFrom(metadata,imageKey,key,imageSha){return {id:key,familyId:metadata.familyId,editionId:metadata.editionId,duplicateGroup:metadata.duplicateGroup,
  split:'train',image:`derived/${imageKey}.jpg`,sha256:imageSha,annotations:`labels/${key}.json`,mapKind:metadata.mapKind,language:metadata.language,script:metadata.script,
  geographicScope:metadata.geographicScope,scopeEvidence:metadata.scopeEvidence,
  source:Object.fromEntries(['url','metadataUrl','license','rightsUrl','published'].map(name=>[name,metadata[name]??null]))};}

export async function prepareMacroSheet({source,root,maximumDimension=2560,metadataPath,signal},{workspace=projectRoot,pdfDirectory,imageDirectory}={}){
  signal?.throwIfAborted();if(typeof source!=='string'||!source||typeof root!=='string'||!root)throw Error('Explicit macro source and corpus required');
  const base=realpath(resolve(root)),pdf=realpath(resolve(source));
  if(worktrees.some(path=>within(path,base)))throw Error('Macro materials belong in external library storage');
  if(!within(base,pdf)||extname(pdf).toLowerCase()!=='.pdf')throw Error('Contained macro source PDF required');
  const sourcePdf=normal(relative(base,pdf)),originalName=sourcePdf.slice(0,-4)+'.source.json';
  const originalPath=realpath(await resolveCorpusPath(base,originalName)),actualMetadata=metadataPath?realpath(resolve(metadataPath)):originalPath;
  if(!within(base,actualMetadata))throw Error(`Contained source metadata required: ${base} -> ${actualMetadata} (${relative(base,actualMetadata)})`);
  const sourceMetadata=normal(relative(base,actualMetadata));await resolveCorpusPath(base,sourceMetadata);
  const metadataBytes=readTrainingBounded(actualMetadata,8*1024*1024),originalBytes=readTrainingBounded(originalPath,8*1024*1024);
  const metadata=JSON.parse(metadataBytes),original=JSON.parse(originalBytes),key=metadata.id,imageKey=original.id,sourceSha256=trainingFileIdentity(pdf);
  if(![key,imageKey].every(value=>typeof value==='string'&&/^[a-z0-9-]+$/.test(value))||metadata.sha256!==sourceSha256)
    throw Error('Pinned macro source identity required');
  if(actualMetadata!==originalPath){const immutable=value=>Object.fromEntries(Object.entries(value).filter(([name])=>!['id','supervision','excludedRegionsNormalized'].includes(name)));
    if(key===imageKey||!isDeepStrictEqual(immutable(metadata),immutable(original)))throw Error('Alternate supervision must preserve original identity with a distinct id');}
  const paths={image:`derived/${imageKey}.jpg`,raster:`derived/${key}.mask.png`,validRaster:`derived/${key}.valid.png`,notice:`notices/${imageKey}.txt`,annotations:`labels/${key}.json`};
  for(const name of ['derived','labels','notices'])if(existsSync(join(base,name)))folder(base,name);
  const previous=regular(join(base,paths.annotations));
  if(previous){const annotation=JSON.parse(previous),image=regular(join(base,paths.image)),notice=regular(join(base,paths.notice));
    if(!image||!notice||annotation.raster?.path!==paths.raster||annotation.validRaster?.path!==paths.validRaster||
      annotation.maximumDimension!==maximumDimension||annotation.sourcePdf!==sourcePdf||annotation.sourceSha256!==sourceSha256||
      annotation.sourceMetadata!==sourceMetadata||annotation.sourceMetadataSha256!==sha(metadataBytes))throw Error('Existing macro evidence differs');
    const sheet=sheetFrom(metadata,imageKey,key,sha(image));
    await validateMacroSheet({root:base,sheet,annotation},{signal,workspace,pdfDirectory,imageDirectory});return sheet;
  }
  const identity={script:'tools/reference-analysis/prepare-macro.mjs',sha256:sourceHash(),renderer:'MuPDF',rendererVersion:'1.26.11'};
  const result=await deriveMacroPdf({path:pdf,metadata,maximumDimension},{signal,workspace,pdfDirectory,imageDirectory});
  const image=await encodePublisherRgbJpeg({width:result.width,height:result.height,rgb:result.image},{signal,workspace,directory:pdfDirectory,imageDirectory});
  const raster=await encodeNativeGrayPng({width:result.width,height:result.height,data:result.target},{signal,workspace,directory:imageDirectory});
  const validRaster=await encodeNativeGrayPng({width:result.width,height:result.height,data:result.known},{signal,workspace,directory:imageDirectory});
  if(result.sourceSha256!==sourceSha256||trainingFileIdentity(pdf)!==sourceSha256||trainingFileIdentity(actualMetadata)!==sha(metadataBytes)||
    trainingFileIdentity(originalPath)!==sha(originalBytes)||sourceHash()!==identity.sha256)throw Error('Macro source or generator changed during derivation');
  const sheet=sheetFrom(metadata,imageKey,key,sha(image));validateCorpusMetadata({schemaVersion:1,trainingOnly:true,sheets:[sheet]},{trainingOnly:true});
  const annotation={schemaVersion:1,origin:'macro-vector-supervision',reviewed:false,supervisionQuality:'source-derived-weak',width:result.width,height:result.height,maximumDimension,
    observedChannels:channels.filter((_,i)=>result.known.some(value=>value&(1<<i))),sourcePdf,sourceSha256,sourceMetadata,sourceMetadataSha256:sha(metadataBytes),producer:identity,
    positivePixels:Object.fromEntries(channels.map((name,i)=>[name,result.target.reduce((sum,value)=>sum+!!(value&(1<<i)),0)])),
    raster:{path:paths.raster,sha256:sha(raster)},validRaster:{path:paths.validRaster,sha256:sha(validRaster)}};
  const credits=new TextDecoder('utf-8',{fatal:true}).decode(result.credits);
  const payload={image,raster,validRaster,notice:Buffer.from(`${metadata.url}\n${metadata.license}\n${credits}`),annotations:Buffer.from(JSON.stringify(annotation,null,2)+'\n')};
  for(const [name,path] of Object.entries(paths)){const old=regular(join(base,path));if(old&&!old.equals(payload[name]))throw Error('Existing macro evidence differs: '+path);}
  const created=[];
  try{for(const name of ['derived','labels','notices'])folder(base,name);
    for(const [name,path] of Object.entries(paths)){const target=join(base,path);if(!existsSync(target)){writeFileSync(target,payload[name],{flag:'wx'});created.push({target,sha256:sha(payload[name])});}}
    await validateMacroSheet({root:base,sheet,annotation},{signal,workspace,pdfDirectory,imageDirectory});return sheet;
  }catch(error){for(const item of created.reverse()){try{const info=lstatSync(item.target);if(info.isFile()&&!info.isSymbolicLink()&&within(base,realpath(item.target))&&
      trainingFileIdentity(item.target)===item.sha256)unlinkSync(item.target);}catch{/* Preserve uncertain outputs. */}}throw error;}
}

export async function prepareMacroCorpus({sources,maximumDimension=2560,manifestName='corpus.training.json',metadataDirectory,signal},options={}){
  signal?.throwIfAborted();if(typeof sources!=='string'||!sources||typeof manifestName!=='string'||manifestName.includes('..')||!/^[a-z0-9][a-z0-9.-]*\.json$/.test(manifestName))
    throw Error('Explicit sources and safe macro manifest filename required');
  const sourceRoot=realpath(resolve(sources)),base=realpath(dirname(sourceRoot));
  if(worktrees.some(path=>within(path,base)))throw Error('Macro materials belong in external library storage');
  const files=readdirSync(sourceRoot,{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name.endsWith('.pdf')&&existsSync(join(sourceRoot,entry.name.slice(0,-4)+'.source.json'))).map(entry=>entry.name).sort();
  if(!files.length)throw Error('Verified macro sources required');
  const alternates=new Map();if(metadataDirectory!==undefined){const dir=realpath(resolve(metadataDirectory));
    if(!within(base,dir)||dir===sourceRoot||!lstatSync(dir).isDirectory())throw Error('Contained metadata directory distinct from original sources required');
    for(const name of readdirSync(dir).filter(value=>value.endsWith('.source.json'))){if(!files.some(file=>file.slice(0,-4)+'.source.json'===name))throw Error('Unmatched alternate source metadata');alternates.set(name,join(dir,name));}
    if(!alternates.size)throw Error('Empty alternate source metadata');}
  const sheets=[];for(const name of files)sheets.push(await prepareMacroSheet({source:join(sourceRoot,name),root:base,maximumDimension,
    metadataPath:alternates.get(name.slice(0,-4)+'.source.json'),signal},options));
  const target=join(base,manifestName),value={schemaVersion:1,trainingOnly:true,sheets};validateCorpusMetadata(value,{trainingOnly:true});
  const old=regular(target);if(old){const recorded=JSON.parse(old),byId=new Map(sheets.map(sheet=>[sheet.id,sheet]));
    if(Array.isArray(recorded.sheets)&&recorded.sheets.length===sheets.length&&new Set(recorded.sheets.map(row=>row.id)).size===sheets.length&&
      recorded.sheets.every(row=>byId.has(row.id)))value.sheets=recorded.sheets.map(row=>byId.get(row.id));
    if(!isDeepStrictEqual(recorded,value))throw Error('Existing macro corpus differs');}
  else writeFileSync(target,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  return {manifest:target,maps:sheets.length,focus:'macro-only',trainingOnly:true,independentEvaluation:false};
}
if(process.argv[1]&&resolve(process.argv[1])===script){try{const {values,positionals}=parseArgs({allowPositionals:true,options:{sources:{type:'string'},'maximum-dimension':{type:'string'},'manifest-name':{type:'string'},'metadata-directory':{type:'string'}}});
  if(positionals.length||!values.sources)throw Error('Explicit macro sources required');const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{console.log(JSON.stringify(await prepareMacroCorpus({sources:reportArgument(values.sources,{access:'write'}),maximumDimension:values['maximum-dimension']===undefined?2560:Number(values['maximum-dimension']),
    manifestName:values['manifest-name'],metadataDirectory:values['metadata-directory'],signal:controller.signal})));}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}catch(error){console.error('prepare-macro: '+error.message);process.exitCode=1;}}
