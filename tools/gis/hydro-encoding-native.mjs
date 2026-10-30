import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
export const hydroEncodingSources=Object.freeze(['tools/cpp/hydro-encoding/CMakeLists.txt','tools/cpp/hydro-encoding/encode.cpp',
  'shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
export async function encodeHydroFeatures(features,{root=rootDefault,directory=resolve(root,'build-native/hydro-encoding/artifact'),signal}={}){
  signal?.throwIfAborted();if(!Array.isArray(features)||!features.length||features.length>10000)throw Error('Explicit bounded Hydro features required');
  const input=JSON.stringify({features});if(Buffer.byteLength(input)>256*1024*1024)throw Error('Hydro encoding exceeds input budget');
  const executable=process.platform==='win32'?'pando-hydro-encoding.exe':'pando-hydro-encoding';
  const {binary}=verifyNativeTool({root,directory,target:'hydro-encoding',executable,sourceFiles:hydroEncodingSources});
  const output=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:512*1024*1024,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native Hydro encoding failed: '+error.message+' '+stderr,{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.end(input);
  });
  signal?.throwIfAborted();const result=JSON.parse(output);
  if(!Array.isArray(result?.features)||result.features.length!==features.length)throw Error('Invalid Hydro encoding result');
  return result.features.map(row=>{
    if(!row||typeof row.featureHex!=='string'||typeof row.sourceIdsHex!=='string'||
      !/^(?:[a-f0-9]{2})+$/.test(row.featureHex)||!/^(?:[a-f0-9]{2})*$/.test(row.sourceIdsHex))throw Error('Invalid Hydro encoded bytes');
    return {feature:Buffer.from(row.featureHex,'hex'),sourceIds:Buffer.from(row.sourceIdsHex,'hex')};
  });
}
