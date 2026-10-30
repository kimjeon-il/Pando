// Import only the author's real training partition into external library storage.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,statfsSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {convertNativeSemapLabels,countNativeTrainingSupervision,encodeNativeGrayPng,inspectNativeSemapImage,readNativeTrainingMask} from '../map-image/native-resample.mjs';
import {openSemapArchive,orderSemapTrainingMembers,readSemapEvidence,readTrainingPartition,semapMemberIdentity} from './semap-source.mjs';

const projectRoot=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(root,path)=>{const part=relative(root,path);return part===''||(!part.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&part!=='..'&&!isAbsolute(part));};
function directory(parent,name){const path=join(parent,name);if(existsSync(path)){const item=lstatSync(path);if(item.isSymbolicLink()||!item.isDirectory())throw Error('Linked or non-directory Semap storage path');}
  else mkdirSync(path);return path;}
function safePath(root,path){const parts=path.split('/');if(parts.some(part=>!part||part==='.'||part==='..'||!/^[A-Za-z0-9_.-]+$/.test(part)))throw Error('Unsafe Semap evidence path');
  let parent=root;for(const part of parts.slice(0,-1))parent=directory(parent,part);return join(parent,parts.at(-1));}
function existing(path){if(!existsSync(path))return null;const item=lstatSync(path);if(item.isSymbolicLink()||!item.isFile()||item.size>16*1024*1024)
  throw Error('Existing Semap evidence is not a bounded regular file; preserve it');return readFileSync(path);}
function put(root,path,value){const target=safePath(root,path),bytes=Buffer.from(value),prior=existing(target);
  if(prior&&!prior.equals(bytes))throw Error('Existing Semap evidence differs; preserve it: '+path);
  if(!prior)writeFileSync(target,bytes,{flag:'wx'});return {path,sha256:sha(bytes)};}

export async function prepareSemapCorpus({output,perInstitution=4,manifestName='corpus.training.json',maximumMaps=96,signal,
  source={readEvidence:readSemapEvidence,openArchive:openSemapArchive},onAccepted}={}){
  signal?.throwIfAborted();
  if(!output||!Number.isInteger(perInstitution)||perInstitution<1||perInstitution>16||!Number.isInteger(maximumMaps)||maximumMaps<1||maximumMaps>192||
    typeof manifestName!=='string'||!/^[a-z0-9.-]+\.json$/.test(manifestName)||!source||typeof source.readEvidence!=='function'||typeof source.openArchive!=='function'||
    (onAccepted!==undefined&&typeof onAccepted!=='function'))throw Error('Explicit bounded Semap import configuration required');
  const requested=resolve(output),parent=realpathSync(dirname(requested)),root=join(parent,basename(requested));
  if(within(projectRoot,root))throw Error('Semap materials belong in external library storage');
  if(existsSync(root)){const item=lstatSync(root);if(item.isSymbolicLink()||!item.isDirectory())throw Error('Existing Semap output must be a real directory');}
  const disk=statfsSync(parent),free=disk.bavail*disk.bsize,peak=maximumMaps*(32*1024*1024)+128*1024*1024;
  if(!Number.isSafeInteger(free)||free<(peak>=1024**3?peak+5*1024**3:Math.max(256*1024**2,peak)))throw Error('Insufficient space for bounded Semap import');
  if(!existsSync(root))mkdirSync(root);
  const names=['partitions.zip','license_images.md','README.md'];
  const payloads=await Promise.all(names.map(name=>source.readEvidence(name,{signal})));signal?.throwIfAborted();
  if(payloads.some(bytes=>!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>8*1024*1024))throw Error('Bounded Semap source evidence required');
  const evidence=names.map((name,i)=>put(root,'sources/'+name,payloads[i])),training=await readTrainingPartition(payloads[0],{signal});
  const [images,labels]=await Promise.all(['images.zip','labels.zip'].map(name=>source.openArchive(name,{signal})));
  if(!Array.isArray(images?.members)||typeof images.readMember!=='function'||!Array.isArray(labels?.members)||typeof labels.readMember!=='function')
    throw Error('Verified Semap image and label archives required');
  const ordered=orderSemapTrainingMembers(images.members.map(row=>row.name),training),counts=new Map(),accepted=new Set(),sheets=[];
  const producerPath=fileURLToPath(import.meta.url),producer={script:'tools/reference-analysis/prepare-semap.mjs',sha256:sha(Buffer.from(readFileSync(producerPath,'utf8').replaceAll('\r\n','\n')))};
  for(const member of ordered){signal?.throwIfAborted();const {institution,document}=semapMemberIdentity(member),original=institution+'\0'+document;
    if(accepted.has(original)||(counts.get(institution)||0)>=perInstitution||sheets.length>=maximumMaps)continue;
    const key=member.slice(member.lastIndexOf('/')+1,-4),labelPath=`sources/${key}.png`,imagePath=`sources/${key}.jpg`;
    const labelBytes=await labels.readMember(`labels/real/${key}.png`,existing(safePath(root,labelPath))??undefined);
    const labelHash=sha(labelBytes),labelPixels=await readNativeTrainingMask(labelBytes,labelHash,{signal}),converted=await convertNativeSemapLabels(labelPixels,{signal});
    if(!converted.informative)continue;
    const imageBytes=await images.readMember(member,existing(safePath(root,imagePath))??undefined),imageHash=sha(imageBytes);
    const info=await inspectNativeSemapImage(imageBytes,imageHash,{signal});
    if(info.width!==labelPixels.width||info.height!==labelPixels.height)throw Error('Semap real image/label grid differs');
    const imageSpec=put(root,imagePath,imageBytes),labelSpec=put(root,labelPath,labelBytes);
    const [targetPng,knownPng,supervision]=await Promise.all([encodeNativeGrayPng(converted.target,{signal}),encodeNativeGrayPng(converted.known,{signal}),
      countNativeTrainingSupervision(converted.target,converted.known,{signal})]);
    const raster=put(root,`derived/${key}.raster.png`,targetPng),validRaster=put(root,`derived/${key}.validRaster.png`,knownPng);
    const sheet={id:'semap-'+key,familyId:'semap-all-production-families-unresolved',editionId:'semap-'+institution+'-'+document,
      duplicateGroup:'semap-'+institution+'_'+document,split:'train',image:imageSpec.path,sha256:imageSpec.sha256,annotations:`labels/${key}.json`,
      mapKind:info.mapKind,mapKindBasis:'input-raster-chroma-heuristic',language:'und',script:'Unknown',source:{url:'https://zenodo.org/records/19048095',
        license:'Annotations CC BY 4.0; image institution terms in sources/license_images.md',institution,originalItem:key.replace(/_[^_]+_[^_]+$/,''),published:null}};
    const channelNames=['international','administrative','coast','hydro','transport','text','frame'];
    const annotation={schemaVersion:1,origin:'semap-human-mask-export',reviewed:false,width:info.width,height:info.height,observedChannels:['hydro','transport'],
      producer,sourceFiles:[imageSpec,labelSpec,...evidence],authorPartition:'train',synthetic:false,originalImageMember:member,
      labelMapping:{'4':'hydro','5':'transport'},ignoredSourceClasses:[0,1],positivePixels:Object.fromEntries(channelNames.map((name,i)=>[name,supervision[i][1]])),raster,validRaster};
    const annotationPath=safePath(root,sheet.annotations),prior=existing(annotationPath);
    if(prior){const old=JSON.parse(prior);delete old.producer;const current={...annotation};delete current.producer;
      if(!isDeepStrictEqual(old,current))throw Error('Existing Semap label derivation differs; preserve it');}
    else put(root,sheet.annotations,Buffer.from(JSON.stringify(annotation,null,2)+'\n'));
    sheets.push(sheet);accepted.add(original);counts.set(institution,(counts.get(institution)||0)+1);if(onAccepted)await onAccepted({id:sheet.id,chroma:info.chroma});
  }
  if(!sheets.length)throw Error('No licensed real training members selected');
  put(root,manifestName,Buffer.from(JSON.stringify({schemaVersion:1,trainingOnly:true,sheets},null,2)+'\n'));
  return {manifest:join(root,manifestName),sheets:sheets.length,trainingOnly:true,independentEvaluation:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{output:{type:'string'},'per-institution':{type:'string'},'manifest-name':{type:'string'},'maximum-maps':{type:'string'}}});
    if(positionals.length)throw Error('Explicit Semap output required');
    const result=await prepareSemapCorpus({output:values.output,perInstitution:values['per-institution']===undefined?4:Number(values['per-institution']),
      manifestName:values['manifest-name']??'corpus.training.json',maximumMaps:values['maximum-maps']===undefined?96:Number(values['maximum-maps'])});
    console.log(JSON.stringify(result));
  }catch(error){console.error('prepare-semap: '+error.message);process.exitCode=1;}
}
