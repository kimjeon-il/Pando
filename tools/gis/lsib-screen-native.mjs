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
export async function mergeLSIBLines(geometries,options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(geometries)||!geometries.length||geometries.length>10000)throw Error('Explicit LSIB line geometries required');
  const merged=[];let batch=[],size=0;
  async function flush(){
    if(!batch.length)return;
    const result=await nativeRequest('--merge-lsib-lines',{geometries:batch},options);
    if(!Array.isArray(result?.geometries)||result.geometries.length!==batch.length||
      result.geometries.some(g=>!g||!['LineString','MultiLineString'].includes(g.type)||!Array.isArray(g.coordinates)))
      throw Error('Invalid native LSIB line merge result');
    merged.push(...result.geometries);batch=[];size=0;
  }
  for(const geometry of geometries){
    if(!geometry||!['LineString','MultiLineString'].includes(geometry.type)||!Array.isArray(geometry.coordinates))throw Error('Explicit LSIB line geometries required');
    const bytes=Buffer.byteLength(JSON.stringify(geometry))+1;
    if(bytes>16*1024*1024)throw Error('LSIB line geometry exceeds byte budget');
    if(size+bytes>16*1024*1024)await flush();batch.push(geometry);size+=bytes;
  }
  await flush();return merged;
}
export async function prepareLSIBReplacements(old,references,options={}){
  options.signal?.throwIfAborted();validateLine(old);
  if(!Array.isArray(references)||!references.length||references.length>10000)throw Error('Explicit bounded LSIB reference lines required');
  for(const line of references)validateLine(line);
  const result=await nativeRequest('--replace-lsib-chains',{old,references},options);
  if(!Array.isArray(result?.results)||result.results.length!==references.length)throw Error('Invalid LSIB replacement receipt');
  for(const row of result.results){
    if(typeof row?.error==='string'&&row.error&&Object.keys(row).length===1)continue;
    if(!row?.value||Object.keys(row).length!==1)throw Error('Invalid LSIB replacement result');
    const value=row.value;validateLine(value.coordinates);validateLine(value.anchors);
    if(value.anchors.length!==2||!['retained_length_degrees','source_length_degrees','replaced_length_degrees','simplification_bound_px']
      .every(key=>typeof value[key]==='number'&&Number.isFinite(value[key])&&value[key]>=0)||
      !['master_vertices','derived_vertices'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=2))throw Error('Invalid LSIB replacement metrics');
  }
  return result.results;
}
export async function prepareLSIBReference({geometries,anchors,merge,closedRing},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(geometries)||!geometries.length||!Array.isArray(anchors)||typeof merge!=='boolean'||typeof closedRing!=='boolean')
    throw Error('Explicit LSIB reference sources and selection required');
  if(!closedRing)validateLine(anchors);
  const result=await nativeRequest('--prepare-lsib-reference',{geometries,anchors,merge,closedRing},options);
  validateLine(result?.coordinates);return result.coordinates;
}
export async function prepareLSIBReviewed(mode,geometry,options={}){
  options.signal?.throwIfAborted();
  if(!['igm','coast'].includes(mode)||!geometry||typeof geometry!=='object')throw Error('Explicit reviewed LSIB source required');
  const result=await nativeRequest('--prepare-lsib-reviewed',{mode,geometry},options);
  validateLine(result?.coordinates);
  if(mode==='igm'&&(typeof result.transformation?.description!=='string'||!result.transformation.description||
    !Number.isFinite(result.transformation.accuracyMetres)))throw Error('Invalid reviewed LSIB transformation metadata');
  return result;
}
export async function analyzeLSIBSection(request,options={}){
  options.signal?.throwIfAborted();
  if(!request||!request.geometry||!Array.isArray(request.geometries)||!request.geometries.length||!Array.isArray(request.anchors)||
    typeof request.merge!=='boolean'||typeof request.closedRing!=='boolean')throw Error('Explicit LSIB section inputs required');
  if(!request.closedRing)validateLine(request.anchors);
  const result=await nativeRequest('--analyze-lsib-section',request,options);
  validateLine(result?.reference);validateLine(result?.display);
  for(const value of [result.forward,result.reverse])if(!Number.isSafeInteger(value?.samples)||value.samples<2||
    typeof value.sampledMaximumCssPx!=='number'||!Number.isFinite(value.sampledMaximumCssPx)||value.sampledMaximumCssPx<0)
    throw Error('Invalid native LSIB section distance');
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||!['--sampled-stream','--display-stream','--replacement-stream'].includes(process.argv[2]))throw Error('Expected an LSIB screen operation');
    const chunks=[];let size=0;
    for await(const chunk of process.stdin){size+=chunk.length;if(size>32*1024*1024)throw Error('LSIB line request exceeds byte budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    const result=process.argv[2]==='--sampled-stream'?await sampledLSIBDistance(request.source,request.target):
      process.argv[2]==='--replacement-stream'?{results:await prepareLSIBReplacements(request.old,request.references)}:
      {coordinates:await selectLSIBDisplay(request.geometry,request.anchors,request.reference)};
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){process.stderr.write('lsib-screen: '+String(error.message)+'\n');process.exitCode=1;}
}
