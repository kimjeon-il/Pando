// Selected-line screen comparison uses the existing GEOS territorial engine.
import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function sampledLSIBDistance(source,target,{binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY,signal}={}){
  signal?.throwIfAborted();
  for(const line of [source,target])if(!Array.isArray(line)||line.length<2||line.length>1000000||
    line.some(point=>!Array.isArray(point)||point.length!==2||point.some(value=>typeof value!=='number'||!Number.isFinite(value))))
    throw Error('Explicit bounded two-dimensional LSIB line coordinates required');
  if(typeof binary!=='string'||!binary)throw Error('PANDO_TERRITORIAL_RECIPE_BINARY must locate the native GEOS engine');
  const input=JSON.stringify({source,target});if(Buffer.byteLength(input)>32*1024*1024)throw Error('LSIB line request exceeds byte budget');
  const output=await new Promise((accept,reject)=>{
    const child=execFile(binary,['--sampled-lsib-screen','-'],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:65536,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native LSIB screen sampling failed: '+error.message+' '+stderr,{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.end(input);
  });
  signal?.throwIfAborted();const result=JSON.parse(output);
  if(!Number.isSafeInteger(result?.samples)||result.samples<2||typeof result.sampledMaximumCssPx!=='number'||
    !Number.isFinite(result.sampledMaximumCssPx)||result.sampledMaximumCssPx<0)throw Error('Invalid native LSIB screen result');
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--sampled-stream')throw Error('Expected --sampled-stream');
    const chunks=[];let size=0;
    for await(const chunk of process.stdin){size+=chunk.length;if(size>32*1024*1024)throw Error('LSIB line request exceeds byte budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    process.stdout.write(JSON.stringify(await sampledLSIBDistance(request.source,request.target))+'\n');
  }catch(error){process.stderr.write('lsib-screen: '+String(error.message)+'\n');process.exitCode=1;}
}
