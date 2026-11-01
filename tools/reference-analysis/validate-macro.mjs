// Recompute one source-derived macro sheet without promoting it to review truth.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {readNativeTrainingMask} from '../map-image/native-resample.mjs';
import {resolveCorpusPath} from './corpus-path.mjs';
import {deriveMacroPdf} from './native-macro-pdf.mjs';
import {encodePublisherRgbJpeg} from './native-publisher-pdf.mjs';
import {validateMacroProvenance} from './reviewed-corpus.mjs';
import {readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const channels=['international','administrative','coast','hydro','transport','text','frame'];
export async function validateMacroSheet({root,sheet,annotation},{signal,workspace,pdfDirectory,imageDirectory}={}){
  signal?.throwIfAborted();
  await validateMacroProvenance(annotation,sheet,root,{rendererVersion:'1.26.6',signal});
  const source=await resolveCorpusPath(root,annotation.sourcePdf),metadataPath=await resolveCorpusPath(root,annotation.sourceMetadata);
  const metadataBytes=readTrainingBounded(metadataPath,8*1024*1024),metadata=JSON.parse(metadataBytes);
  const result=await deriveMacroPdf({path:source,metadata,maximumDimension:annotation.maximumDimension},{signal,workspace,pdfDirectory,imageDirectory});
  if(result.sourceSha256!==annotation.sourceSha256||sha(metadataBytes)!==annotation.sourceMetadataSha256||
    result.width!==annotation.width||result.height!==annotation.height)throw Error('Macro source dimensions or identity differ');
  for(const [field,expected] of [['raster',result.target],['validRaster',result.known]]){
    const path=await resolveCorpusPath(root,annotation[field]?.path),bytes=readTrainingBounded(path,300*1024*1024);
    const raster=await readNativeTrainingMask(bytes,annotation[field].sha256,{signal,workspace,directory:imageDirectory});
    if(raster.width!==result.width||raster.height!==result.height||!Buffer.from(raster.data).equals(expected))
      throw Error('Macro source supervision differs: '+field);
  }
  const image=await encodePublisherRgbJpeg({width:result.width,height:result.height,rgb:result.image},{signal,workspace,directory:pdfDirectory,imageDirectory});
  if(sha(image)!==sheet.sha256||trainingFileIdentity(await resolveCorpusPath(root,sheet.image))!==sheet.sha256)throw Error('Macro source image differs');
  const counts=channels.map((_,index)=>result.target.reduce((sum,value)=>sum+!!(value&(1<<index)),0));
  const observed=channels.filter((_,index)=>result.known.some(value=>value&(1<<index)));
  if(!isDeepStrictEqual(annotation.observedChannels,observed)||
    !isDeepStrictEqual(annotation.positivePixels,Object.fromEntries(channels.map((name,index)=>[name,counts[index]]))))
    throw Error('Macro source supervision statistics differ');
  if(trainingFileIdentity(source)!==annotation.sourceSha256||trainingFileIdentity(metadataPath)!==annotation.sourceMetadataSha256)
    throw Error('Macro source changed during validation');
  return {valid:true,sheets:1,trainingOnly:true,independentEvaluation:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==3||process.argv[2]!=='--sheet-stream')throw Error('Expected --sheet-stream');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>16*1024*1024)throw Error('Macro request exceeds budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    console.log(JSON.stringify(await validateMacroSheet(request)));
  }catch(error){console.error('validate-macro: '+error.message);process.exitCode=1;}
}
