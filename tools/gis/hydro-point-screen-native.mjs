import {execFile} from 'node:child_process';
import {readFileSync,statSync} from 'node:fs';
import {delimiter,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const hydroPointScreenSources=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/hydro/point-screen.cpp',
  'shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
export function lineParts(geometry){
  if(geometry?.type==='LineString')return [geometry.coordinates];
  if(geometry?.type==='MultiLineString')return geometry.coordinates;
  throw Error('Unrecognized line geometry type: '+geometry?.type);
}
export function validatePointScreenResult(result,lineCount,pointCount,{allowFilteredLines=false}={}){
  if(!result||!Array.isArray(result.lineLengthsMeters)||
    (allowFilteredLines?(result.lineLengthsMeters.length<1||result.lineLengthsMeters.length>lineCount):result.lineLengthsMeters.length!==lineCount)||
    result.lineLengthsMeters.some(value=>!Number.isFinite(value)||value<0)||!Array.isArray(result.points)||result.points.length!==pointCount||
    result.points.some(item=>!item||!Number.isFinite(item.distanceMeters)||item.distanceMeters<0||
      !Array.isArray(item.nearestLonLat)||item.nearestLonLat.length!==2||item.nearestLonLat.some(value=>!Number.isFinite(value))))
    throw Error('Invalid native point-screen result');
}
export function windowsHydroRuntime(root){
  if(typeof root!=='string'||!root)throw Error('The matching OSGeo4W runtime root is required');
  const runtime=resolve(root),installed=readFileSync(join(runtime,'etc/setup/installed.db'),'utf8');
  for(const entry of ['geos geos-3.15.0-1.tar.bz2','proj9-runtime proj9-runtime-9.8.1-1.tar.bz2',
    'proj-runtime-data proj-runtime-data-9.8.1-1.tar.bz2']){
    if(!installed.split(/\r?\n/).some(line=>line.startsWith(entry+' ')))throw Error('OSGeo4W runtime version mismatch: '+entry.split(' ')[0]);
  }
  for(const name of ['bin/geos_c.dll','bin/proj_9.dll','share/proj/proj.db']){
    if(!statSync(join(runtime,name)).isFile())throw Error('OSGeo4W runtime file is missing: '+name);
  }
  return {bin:join(runtime,'bin'),projData:join(runtime,'share/proj')};
}
export async function screenHydroPoints(input,{root=defaultRoot,directory=resolve(root,'build-native/hydro-point-screen/artifact'),runtimeRoot,signal}={}){
  signal?.throwIfAborted();
  const executable=process.platform==='win32'?'pando-hydro-point-screen.exe':'pando-hydro-point-screen';
  const {binary,manifest}=verifyNativeTool({root,directory,target:'hydro-point-screen',executable,sourceFiles:hydroPointScreenSources});
  const environment={...process.env};
  if(process.platform==='win32'){
    if(manifest.runtimeVersion!=='osgeo4w-geos-3.15.0-proj-9.8.1')throw Error('Native Hydro point screen runtime mismatch');
    const runtime=windowsHydroRuntime(runtimeRoot);environment.PATH=runtime.bin+delimiter+(process.env.PATH||'');
    environment.PROJ_DATA=runtime.projData;environment.PROJ_LIB=runtime.projData;
  }
  const bytes=JSON.stringify(input);if(Buffer.byteLength(bytes)>256*1024*1024)throw Error('Point-screen input too large');
  const stdout=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024,signal,env:environment},
      (error,text,stderr)=>error?reject(new Error('Native Hydro point screen failed: '+error.message+' '+stderr,{cause:error})):accept(text));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.end(bytes);
  });
  signal?.throwIfAborted();return JSON.parse(stdout);
}
