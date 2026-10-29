import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const hydroPointScreenSources=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/hydro/point-screen.cpp',
  'shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
export async function screenHydroPoints(input,{root=defaultRoot,directory=resolve(root,'build-native/hydro-point-screen/artifact'),signal}={}){
  signal?.throwIfAborted();
  const executable=process.platform==='win32'?'pando-hydro-point-screen.exe':'pando-hydro-point-screen';
  const {binary}=verifyNativeTool({root,directory,target:'hydro-point-screen',executable,sourceFiles:hydroPointScreenSources});
  const bytes=JSON.stringify(input);if(Buffer.byteLength(bytes)>256*1024*1024)throw Error('Point-screen input too large');
  const stdout=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024,signal},
      (error,text,stderr)=>error?reject(new Error('Native Hydro point screen failed: '+error.message+' '+stderr,{cause:error})):accept(text));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.end(bytes);
  });
  signal?.throwIfAborted();return JSON.parse(stdout);
}
