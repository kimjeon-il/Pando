// Source-bound publisher PDF layer inspection and rendering. No training labels
// or model approval are inferred from these raster planes.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';
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
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>16*1024*1024*3+1024*1024){child.kill();finish(Error('Publisher PDF output exceeds budget'));}else out.push(chunk);});
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
async function operation({path,args,signal,workspace,directory,source}){
  signal?.throwIfAborted();if(typeof path!=='string'||!path)throw Error('Explicit publisher PDF path required');
  const actual=resolve(path),input=source??readTrainingBounded(actual,300*1024*1024),identity=sha(input);
  if(trainingFileIdentity(actual,{maxBytes:300*1024*1024})!==identity)throw Error('Publisher PDF changed before rendering');
  const binary=artifact(workspace,directory),output=await invoke(binary,args,input,signal);
  if(trainingFileIdentity(actual,{maxBytes:300*1024*1024})!==identity)throw Error('Publisher PDF changed during rendering');
  const end=output.indexOf(10);if(end<0||end>1024*1024)throw Error('Publisher PDF header exceeds budget');
  const header=JSON.parse(output.subarray(0,end).toString('utf8'));
  return {header,data:output.subarray(end+1),sourceSha256:identity};
}
function checkInfo({header,data,sourceSha256}){
  if(data.length||header.pageCount!==1||header.rotation!==0||!Array.isArray(header.layers)||!header.layers.length||header.layers.length>1024||
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
  const {width,height,scale}=result.header;
  if(result.sourceSha256!==info.sourceSha256||![width,height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=4096)||
    !Number.isFinite(scale)||scale<=0||result.data.length!==width*height*3)throw Error('Publisher PDF raster dimensions differ');
  return {width,height,scale,rgb:result.data,sourceSha256:result.sourceSha256};
}
