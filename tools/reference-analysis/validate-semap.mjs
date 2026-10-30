// Verify real author-training Semap sources and derived pixels; never evaluation truth.
import {createHash} from 'node:crypto';
import {basename,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {convertNativeSemapLabels,countNativeTrainingSupervision,inspectNativeSemapImage,readNativeTrainingMask} from '../map-image/native-resample.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';
import {readTrainingBounded} from './training-evidence.mjs';
import {readTrainingPartition,semapMemberIdentity,selectRealTrainingMembers,verifySemapEvidence} from './semap-source.mjs';
import {validateSourceLanguage} from './source-language.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const channels=['international','administrative','coast','hydro','transport','text','frame'];
export async function validateSemapTrainingCorpus(corpus,root,{signal,verifyEvidence=verifySemapEvidence}={}){
  signal?.throwIfAborted();if(!corpus||corpus.schemaVersion!==1||corpus.trainingOnly!==true||!Array.isArray(corpus.sheets)||!corpus.sheets.length||typeof verifyEvidence!=='function')
    throw Error('Explicit real-only Semap training corpus required');
  const seen=new Set(),sources=[];
  for(const sheet of corpus.sheets){signal?.throwIfAborted();
    if(!sheet?.id||seen.has(sheet.id)||sheet.split!=='train'||!sheet.annotations||!sheet.source?.url||!sheet.source?.license||
      !['color','monochrome'].includes(sheet.mapKind)||!/^[a-f0-9]{64}$/.test(sheet.sha256||''))throw Error('Unique Semap training source required');
    seen.add(sheet.id);validateSourceLanguage(sheet);
    const annotationPath=await resolveCorpusPath(root,sheet.annotations),annotationBytes=readTrainingBounded(annotationPath,16*1024*1024),annotationHash=sha(annotationBytes);
    const annotation=JSON.parse(annotationBytes),producer=annotation.producer;
    if(annotation.schemaVersion!==1||annotation.origin!=='semap-human-mask-export'||annotation.reviewed!==false||annotation.authorPartition!=='train'||
      annotation.synthetic!==false||JSON.stringify(annotation.observedChannels)!==JSON.stringify(['hydro','transport'])||
      JSON.stringify(annotation.labelMapping)!==JSON.stringify({'4':'hydro','5':'transport'})||
      !['tools/reference-analysis/semap.py','tools/reference-analysis/prepare-semap.mjs'].includes(producer?.script)||!/^[a-f0-9]{64}$/.test(producer?.sha256||'')||
      !Array.isArray(annotation.sourceFiles)||annotation.sourceFiles.length!==5)throw Error('Verified real-only Semap provenance required');
    const member=annotation.originalImageMember,identity=semapMemberIdentity(member),key=typeof member==='string'?basename(member,'.jpg'):'';
    if(!identity||selectRealTrainingMembers([member],new Set([key])).length!==1||sheet.id!=='semap-'+key||
      sheet.familyId!=='semap-all-production-families-unresolved'||sheet.editionId!==`semap-${identity.institution}-${identity.document}`||
      sheet.duplicateGroup!==`semap-${identity.institution}_${identity.document}`||sheet.source.institution!==identity.institution)
      throw Error('Licensed real Semap member identity required');
    const files=new Map(),checks=[[annotationPath,annotationHash]];
    for(const spec of annotation.sourceFiles){if(!spec||typeof spec.path!=='string'||!/^[a-f0-9]{64}$/.test(spec.sha256||''))throw Error('Semap source evidence identity required');
      const name=basename(spec.path);if(files.has(name))throw Error('Duplicate Semap source evidence');
      const path=await resolveCorpusPath(root,spec.path),bytes=readTrainingBounded(path,16*1024*1024);if(sha(bytes)!==spec.sha256)throw Error('Semap source evidence hash changed');
      files.set(name,{spec,bytes});checks.push([path,spec.sha256]);}
    const expectedNames=[key+'.jpg',key+'.png','partitions.zip','license_images.md','README.md'];
    if(files.size!==5||expectedNames.some(name=>!files.has(name))||files.get(key+'.jpg').spec.path!==sheet.image||files.get(key+'.jpg').spec.sha256!==sheet.sha256)
      throw Error('Semap original and rights evidence required');
    for(const name of expectedNames.slice(2))await verifyEvidence(name,files.get(name).bytes);
    const partition=await readTrainingPartition(files.get('partitions.zip').bytes,{signal});
    if(!partition.has(key))throw Error('Original Semap author training partition required');
    const original=files.get(key+'.png'),labels=await readNativeTrainingMask(original.bytes,original.spec.sha256,{signal});
    const image=files.get(key+'.jpg'),info=await inspectNativeSemapImage(image.bytes,image.spec.sha256,{signal});
    if(info.width!==labels.width||info.height!==labels.height||annotation.width!==info.width||annotation.height!==info.height||sheet.mapKind!==info.mapKind)
      throw Error('Semap original image and label dimensions or classification differ');
    const converted=await convertNativeSemapLabels(labels,{signal});if(!converted.informative)throw Error('Semap source labels are not informative');
    for(const [field,expected] of [['raster',converted.target],['validRaster',converted.known]]){
      const spec=annotation[field];if(!spec||!/^[a-f0-9]{64}$/.test(spec.sha256||''))throw Error('Semap raster identity required');
      const path=await resolveCorpusPath(root,spec.path),bytes=readTrainingBounded(path,16*1024*1024),actual=await readNativeTrainingMask(bytes,spec.sha256,{signal});
      if(actual.width!==expected.width||actual.height!==expected.height||!actual.data.equals(expected.data))throw Error('Semap source label conversion differs');
      checks.push([path,spec.sha256]);
    }
    const counts=await countNativeTrainingSupervision(converted.target,converted.known,{signal});
    if(channels.some((name,i)=>annotation.positivePixels?.[name]!==counts[i][1]))throw Error('Semap positive pixel counts differ');
    for(const [path,expected] of checks)if(sha(readTrainingBounded(path,16*1024*1024))!==expected)throw Error('Semap source changed during verification');
    sources.push({sheet,annotation,checks,counts});
  }
  return {valid:true,sheets:seen.size,trainingOnly:true,independentEvaluation:false,sources};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{corpus:{type:'string'}}});
    if(positionals.length||!values.corpus)throw Error('Explicit --corpus required');const path=resolve(values.corpus);
    const {sources,...result}=await validateSemapTrainingCorpus(JSON.parse(readTrainingBounded(path,32*1024*1024)),dirname(path));
    console.log(JSON.stringify(result));
  }catch(error){console.error('validate-semap: '+error.message);process.exitCode=1;}
}
