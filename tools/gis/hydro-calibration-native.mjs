// Analysis-only Hydro calibration engine; it never writes operating data.
import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
export const hydroCalibrationSources=Object.freeze(['tools/cpp/hydro-calibration/CMakeLists.txt','tools/cpp/hydro/calibration.cpp',
  'shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
export async function countHydroCalibrationChains(features,{root=rootDefault,directory=process.env.PANDO_HYDRO_CALIBRATION_ARTIFACT||resolve(root,'build-native/hydro-calibration/artifact'),signal}={}){
  signal?.throwIfAborted();if(!Array.isArray(features)||features.length>10000000)throw Error('Bounded Hydro calibration features required');
  const executable=process.platform==='win32'?'pando-hydro-calibration.exe':'pando-hydro-calibration';
  const {binary}=verifyNativeTool({root,directory,target:'hydro-calibration',executable,sourceFiles:hydroCalibrationSources});
  const payload=JSON.stringify({mode:'chain',features});if(Buffer.byteLength(payload)>512*1024*1024)throw Error('Hydro calibration input exceeds byte budget');
  const text=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:1024*1024,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native Hydro calibration failed: '+error.message+' '+stderr,{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.end(payload);
  });
  signal?.throwIfAborted();const result=JSON.parse(text),keys=['selectedReachCount','chainCount','sourceCoordinateCount','coordinatesAfterChaining'];
  if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).length!==keys.length||
    keys.some(key=>!Number.isSafeInteger(result[key])||result[key]<0)||result.selectedReachCount>features.length||
    result.chainCount>result.selectedReachCount||result.sourceCoordinateCount!==result.coordinatesAfterChaining)
    throw Error('Invalid native Hydro calibration result');
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--chain-stream')throw Error('Expected --chain-stream');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>512*1024*1024)throw Error('Hydro calibration input exceeds byte budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    console.log(JSON.stringify(await countHydroCalibrationChains(request.features)));
  }catch(error){console.error('hydro-calibration: '+error.message);process.exitCode=1;}
}
