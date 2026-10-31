// Selected-line screen comparison uses the existing GEOS territorial engine.
import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

function validateLine(line){
  if(!Array.isArray(line)||line.length<2||line.length>1000000||
    line.some(point=>!Array.isArray(point)||point.length!==2||point.some(value=>typeof value!=='number'||!Number.isFinite(value))))
    throw Error('Explicit bounded two-dimensional LSIB line coordinates required');
}
async function nativeRequest(action,request,{binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY,signal}={}){
  signal?.throwIfAborted();
  if(typeof binary!=='string'||!binary)throw Error('PANDO_TERRITORIAL_RECIPE_BINARY must locate the native GEOS engine');
  const input=JSON.stringify(request);if(Buffer.byteLength(input)>32*1024*1024)throw Error('LSIB line request exceeds byte budget');
  const output=await new Promise((accept,reject)=>{
    const child=execFile(binary,[action,'-'],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:32*1024*1024,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native LSIB screen operation failed: '+error.message+' '+stderr,{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.end(input);
  });
  signal?.throwIfAborted();return JSON.parse(output);
}
export async function sampledLSIBDistance(source,target,options={}){
  options.signal?.throwIfAborted();validateLine(source);validateLine(target);
  const result=await nativeRequest('--sampled-lsib-screen',{source,target},options);
  if(!Number.isSafeInteger(result?.samples)||result.samples<2||typeof result.sampledMaximumCssPx!=='number'||
    !Number.isFinite(result.sampledMaximumCssPx)||result.sampledMaximumCssPx<0)throw Error('Invalid native LSIB screen result');
  return result;
}
export async function selectLSIBDisplay(geometry,anchors,reference,options={}){
  options.signal?.throwIfAborted();validateLine(reference);
  if(!geometry||!['Polygon','MultiPolygon'].includes(geometry.type)||!Array.isArray(geometry.coordinates)||!Array.isArray(anchors))
    throw Error('Explicit LSIB display geometry and anchors required');
  const result=await nativeRequest('--select-lsib-display',{geometry,anchors,reference},options);
  validateLine(result?.coordinates);return result.coordinates;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||!['--sampled-stream','--display-stream'].includes(process.argv[2]))throw Error('Expected an LSIB screen operation');
    const chunks=[];let size=0;
    for await(const chunk of process.stdin){size+=chunk.length;if(size>32*1024*1024)throw Error('LSIB line request exceeds byte budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    const result=process.argv[2]==='--sampled-stream'?await sampledLSIBDistance(request.source,request.target):
      {coordinates:await selectLSIBDisplay(request.geometry,request.anchors,request.reference)};
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){process.stderr.write('lsib-screen: '+String(error.message)+'\n');process.exitCode=1;}
}
