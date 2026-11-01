// Source-bound publisher PDF layer inspection and rendering. No training labels
// or model approval are inferred from these raster planes.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';
import {encodeNativeJpeg} from '../map-image/native-resample.mjs';
import {readTrainingBounded,trainingFileIdentity} from './training-evidence.mjs';

export const publisherPdfSourceFiles=Object.freeze(['tools/cpp/map-pdf/publisher/CMakeLists.txt',
  'tools/cpp/map-pdf/publisher/publisher-read.c','tools/cpp/map-pdf/MUPDF-COPYING','tools/cpp/map-pdf/MUPDF-AGPL-3.0']);
const root=fileURLToPath(new URL('../../',import.meta.url));
const runtimes={win32:{binary:'pando-publisher-pdf.exe',library:'mupdfcpp64.dll',sha256:'b1ba5816e64d2b321b2a21f89c3a9aa39a493f97519ffbeec3b1e30708a32184'},
  linux:{binary:'pando-publisher-pdf',library:'libmupdf.so.26.11',sha256:'2802c2bfedc5b2f4381d93dc2367c9987fa307fabc45c7a041d819c950cc5791'}};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function invoke(binary,args,input,signal){return new Promise((accept,reject)=>{
  const child=spawn(binary,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,signal}),out=[],errors=[];
  let bytes=0,errorBytes=0,done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):accept(value);};
  const timer=setTimeout(()=>{child.kill();finish(Error('Publisher PDF operation timed out'));},120000);
  child.on('error',error=>finish(error));child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>16*1024*1024*5+9*1024*1024){child.kill();finish(Error('Publisher PDF output exceeds budget'));}else out.push(chunk);});
  child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes<=65536)errors.push(chunk);});
  child.on('close',(code,reason)=>code!==0||reason?finish(Error('Publisher PDF failed: '+Buffer.concat(errors).toString('utf8'))):finish(null,Buffer.concat(out,bytes)));
  child.stdin.end(input);
});}
function artifact(workspace,directory){
  const spec=runtimes[process.platform];if(!spec)throw Error('Unsupported publisher PDF platform');
  const result=verifyNativeTool({root:workspace,directory,target:'publisher-pdf',executable:spec.binary,sourceFiles:publisherPdfSourceFiles});
  if(sha(readFileSync(resolve(directory,spec.library)))!==spec.sha256)throw Error('Publisher PDF MuPDF runtime hash differs');
  return result.binary;
}
async function operation({path,args,signal,workspace,directory,source,binary,knownIdentity,checkSource=true}){
  signal?.throwIfAborted();if(typeof path!=='string'||!path)throw Error('Explicit publisher PDF path required');
  const actual=resolve(path),input=source??readTrainingBounded(actual,300*1024*1024),identity=knownIdentity??sha(input);
  if(checkSource&&trainingFileIdentity(actual,{maxBytes:300*1024*1024})!==identity)throw Error('Publisher PDF changed before rendering');
  const executable=binary??artifact(workspace,directory),output=await invoke(executable,args,input,signal);
  if(checkSource&&trainingFileIdentity(actual,{maxBytes:300*1024*1024})!==identity)throw Error('Publisher PDF changed during rendering');
  const end=output.indexOf(10);if(end<0||end>1024*1024)throw Error('Publisher PDF header exceeds budget');
  const header=JSON.parse(output.subarray(0,end).toString('utf8'));
  return {header,data:output.subarray(end+1),sourceSha256:identity};
}
const layerChannels=Object.freeze({international:['International'],administrative:['State or Territory','County or Equivalent'],
  hydro:['Hydrography'],transport:['Road Features','Trails','Railroads'],frame:['Map Frame','Projection and Grids']});
const channels=Object.freeze(['international','administrative','coast','hydro','transport','text','frame']);
function checkedRaster(result,info){
  const {width,height,scale}=result.header;
  if(result.sourceSha256!==info.sourceSha256||![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=4096)||
    !Number.isFinite(scale)||scale<=0||result.data.length!==width*height*3)throw Error('Publisher PDF raster dimensions differ');
  return {width,height,scale,rgb:result.data,sourceSha256:result.sourceSha256};
}
function checkedText(result,info){
  const {width,height,scale,creditBytes,characters}=result.header;
  if(result.sourceSha256!==info.sourceSha256||![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=4096)||
    !Number.isFinite(scale)||scale<=0||!Number.isSafeInteger(creditBytes)||creditBytes<0||creditBytes>8*1024*1024||
    !Number.isSafeInteger(characters)||characters<0||characters>10000000||result.data.length!==creditBytes+width*height)
    throw Error('Publisher PDF text dimensions differ');
  const credits=result.data.subarray(0,creditBytes),mask=result.data.subarray(creditBytes);
  if(mask.some(value=>value>1))throw Error('Publisher PDF text mask contains invalid pixels');
  return {width,height,scale,credits,mask,characters,sourceSha256:result.sourceSha256};
}
function checkInfo({header,data,sourceSha256}){
  if(data.length||header.pageCount!==1||header.rotation!==0||!Array.isArray(header.sourceRectPts)||header.sourceRectPts.length!==4||
    header.sourceRectPts.some(value=>!Number.isFinite(value))||header.sourceRectPts[2]<=header.sourceRectPts[0]||header.sourceRectPts[3]<=header.sourceRectPts[1]||
    !Array.isArray(header.layers)||!header.layers.length||header.layers.length>1024||
    header.layers.some(row=>typeof row?.name!=='string'||!row.name||typeof row.enabled!=='boolean')||
    new Set(header.layers.map(row=>row.name)).size!==header.layers.length||!Array.isArray(header.ui)||header.ui.length>4096||
    header.ui.some(row=>typeof row?.text!=='string'||!Number.isSafeInteger(row.depth)||row.depth<0||![0,1,2].includes(row.type)))
    throw Error('Unambiguous bounded publisher layer metadata required');
  return {...header,sourceSha256};
}
export async function inspectPublisherPdf({path},{signal,workspace=root,directory=process.env.PANDO_PUBLISHER_PDF_ARTIFACT||resolve(workspace,'build-native/map-pdf/publisher-artifact')}={}){
  return checkInfo(await operation({path,args:['inspect'],signal,workspace,directory}));
}
export async function renderPublisherPdfLayers({path,enabled,maximumDimension},{signal,workspace=root,directory=process.env.PANDO_PUBLISHER_PDF_ARTIFACT||resolve(workspace,'build-native/map-pdf/publisher-artifact')}={}){
  signal?.throwIfAborted();
  if(!Array.isArray(enabled)||enabled.some(value=>typeof value!=='string'||!value)||new Set(enabled).size!==enabled.length)
    throw Error('Explicit unique publisher layer names required');
  if(!Number.isSafeInteger(maximumDimension)||maximumDimension<32||maximumDimension>4096)throw Error('Bounded publisher maximum dimension required');
  const source=readTrainingBounded(resolve(path),300*1024*1024);
  const info=checkInfo(await operation({path,args:['inspect'],signal,workspace,directory,source}));
  const names=new Set(info.layers.map(row=>row.name));if(enabled.some(name=>!names.has(name)))throw Error('Unknown publisher PDF layer');
  const selected=new Set(enabled),bits=info.layers.map(row=>selected.has(row.name)?'1':'0').join('');
  const result=await operation({path,args:['render',String(maximumDimension),bits],signal,workspace,directory,source});
  return checkedRaster(result,info);
}
export async function extractPublisherPdfText({path,maximumDimension},{signal,workspace=root,directory=process.env.PANDO_PUBLISHER_PDF_ARTIFACT||resolve(workspace,'build-native/map-pdf/publisher-artifact')}={}){
  signal?.throwIfAborted();
  if(!Number.isSafeInteger(maximumDimension)||maximumDimension<32||maximumDimension>4096)throw Error('Bounded publisher maximum dimension required');
  const source=readTrainingBounded(resolve(path),300*1024*1024);
  const info=checkInfo(await operation({path,args:['inspect'],signal,workspace,directory,source}));
  const result=await operation({path,args:['text',String(maximumDimension)],signal,workspace,directory,source});
  return checkedText(result,info);
}
// Macro rendering preserves the source's default layer state and unrotates the
// page before extracting the image and glyph exclusion mask. The caller rotates
// all supervision planes together after applying the source recipe.
export async function renderMacroPdf({path,maximumDimension},{signal,workspace=root,directory=process.env.PANDO_PUBLISHER_PDF_ARTIFACT||resolve(workspace,'build-native/map-pdf/publisher-artifact')}={}){
  signal?.throwIfAborted();
  if(typeof path!=='string'||!path||!Number.isSafeInteger(maximumDimension)||maximumDimension<64||maximumDimension>4096)
    throw Error('Explicit bounded macro PDF and dimension required');
  const actual=resolve(path),source=readTrainingBounded(actual,300*1024*1024),sourceSha256=sha(source),binary=artifact(workspace,directory);
  const request={path:actual,signal,workspace,directory,source,binary,knownIdentity:sourceSha256};
  const rasterResult=await operation({...request,args:['macro-render',String(maximumDimension)]});
  const textResult=await operation({...request,args:['macro-text',String(maximumDimension)]});
  const raster=checkedRaster(rasterResult,{sourceSha256}),text=checkedText(textResult,{sourceSha256});
  const rotation=rasterResult.header.rotation;
  if(![0,90,180,270].includes(rotation)||textResult.header.rotation!==rotation||
    raster.width!==text.width||raster.height!==text.height||raster.scale!==text.scale)
    throw Error('Macro PDF text and raster identity differs');
  return {...raster,rotation,textMask:text.mask,credits:text.credits};
}
export async function derivePublisherPdfTrainingLayers({path,maximumDimension},{signal,workspace=root,directory=process.env.PANDO_PUBLISHER_PDF_ARTIFACT||resolve(workspace,'build-native/map-pdf/publisher-artifact')}={}){
  signal?.throwIfAborted();
  if(typeof path!=='string'||!path||!Number.isSafeInteger(maximumDimension)||maximumDimension<32||maximumDimension>4096)
    throw Error('Explicit bounded publisher PDF and dimension required');
  const actual=resolve(path),source=readTrainingBounded(actual,300*1024*1024),identity=sha(source),binary=artifact(workspace,directory);
  const request={path:actual,source,binary,knownIdentity:identity,signal,workspace,directory};
  const info=checkInfo(await operation({...request,args:['inspect']})),names=new Set(info.layers.map(layer=>layer.name));
  for(const required of ['International','Map Frame','Hydrography'])if(!names.has(required))throw Error('Required publisher layer missing: '+required);
  const parents=new Map(),stack=[];
  for(const row of info.ui){while(stack.length&&stack.at(-1).depth>=row.depth)stack.pop();
    if(names.has(row.text)){parents.set(row.text,stack.map(entry=>entry.name));stack.push({depth:row.depth,name:row.text});}}
  const render=async enabled=>{signal?.throwIfAborted();const selected=new Set(enabled),bits=info.layers.map(layer=>selected.has(layer.name)?'1':'0').join('');
    return checkedRaster(await operation({...request,args:['render',String(maximumDimension),bits],checkSource:false}),info);};
  const image=await render([...names].filter(name=>!['Orthoimage','Shaded Relief'].includes(name)));
  const text=checkedText(await operation({...request,args:['text',String(maximumDimension)],checkSource:false}),info);
  if(text.width!==image.width||text.height!==image.height||text.scale!==image.scale)throw Error('Publisher text and raster dimensions differ');
  const pixels=image.width*image.height;let mask=Buffer.alloc(pixels),observedMask=32;const layers={};
  for(const [channel,candidates] of Object.entries(layerChannels)){
    const selected=candidates.filter(name=>names.has(name));if(!selected.length)continue;
    layers[channel]=selected;const bit=1<<channels.indexOf(channel);observedMask|=bit;
    for(const name of selected){const ancestors=parents.get(name)||[],before=await render(ancestors),after=await render([...ancestors,name]);
      if([before,after].some(value=>value.width!==image.width||value.height!==image.height||value.scale!==image.scale))throw Error('Publisher layer raster dimensions differ');
      mask=await invoke(binary,['compare',String(image.width),String(image.height),String(bit)],Buffer.concat([mask,text.mask,before.rgb,after.rgb]),signal);
      if(mask.length!==pixels)throw Error('Publisher layer comparison dimensions differ');}
  }
  const finished=await invoke(binary,['finish',String(image.width),String(image.height),String(observedMask)],Buffer.concat([mask,text.mask]),signal);
  const end=finished.indexOf(10);if(end<0||end>1024)throw Error('Publisher mask result header differs');
  const header=JSON.parse(finished.subarray(0,end).toString('utf8')),data=finished.subarray(end+1);
  if(data.length!==pixels*2||!Array.isArray(header.positivePixels)||header.positivePixels.length!==7||
    header.positivePixels.some(value=>!Number.isSafeInteger(value)||value<0||value>pixels))throw Error('Publisher mask result differs');
  if(trainingFileIdentity(actual,{maxBytes:300*1024*1024})!==identity)throw Error('Publisher PDF changed during derivation');
  artifact(workspace,directory);
  return {width:image.width,height:image.height,scale:image.scale,rgb:image.rgb,mask:data.subarray(0,pixels),validMask:data.subarray(pixels),
    credits:text.credits,observedMask,positivePixels:header.positivePixels,layers,sourceRectPts:info.sourceRectPts,
    sourceSha256:identity,trainingOnly:true,releaseApproved:false};
}
export async function encodePublisherRgbJpeg({width,height,rgb},{signal,workspace=root,
  directory=process.env.PANDO_PUBLISHER_PDF_ARTIFACT||resolve(workspace,'build-native/map-pdf/publisher-artifact'),imageDirectory}={}){
  signal?.throwIfAborted();
  if(![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=4096)||!(rgb instanceof Uint8Array)||rgb.length!==width*height*3)
    throw Error('Bounded publisher RGB pixels required');
  const binary=artifact(workspace,directory),data=await invoke(binary,['rgba',String(width),String(height),'1'],rgb,signal);
  if(data.length!==width*height*4)throw Error('Publisher image conversion dimensions differ');
  return (await encodeNativeJpeg({width,height,data},{signal,workspace,directory:imageDirectory})).data;
}
