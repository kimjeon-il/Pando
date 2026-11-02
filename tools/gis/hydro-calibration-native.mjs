// Analysis-only Hydro calibration engine; it never writes operating data.
import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
export const hydroCalibrationSources=Object.freeze(['tools/cpp/hydro-calibration/CMakeLists.txt','tools/cpp/hydro/calibration.cpp',
  'shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
async function runCalibration(request,{root=rootDefault,directory=process.env.PANDO_HYDRO_CALIBRATION_ARTIFACT||resolve(root,'build-native/hydro-calibration/artifact'),signal}={}){
  signal?.throwIfAborted();
  const executable=process.platform==='win32'?'pando-hydro-calibration.exe':'pando-hydro-calibration';
  const {binary}=verifyNativeTool({root,directory,target:'hydro-calibration',executable,sourceFiles:hydroCalibrationSources});
  const payload=JSON.stringify(request);if(Buffer.byteLength(payload)>512*1024*1024)throw Error('Hydro calibration input exceeds byte budget');
  const text=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'utf8',windowsHide:true,timeout:request.mode==='optimize'?1800000:180000,
      maxBuffer:['assign','directions'].includes(request.mode)?128*1024*1024:1024*1024,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native Hydro calibration failed: '+error.message+' '+stderr,{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.end(payload);
  });
  signal?.throwIfAborted();return JSON.parse(text);
}
export async function compareHydroCalibrationDirections(pairs,options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(pairs)||pairs.length>1000000||pairs.some(pair=>!pair||!['left','right'].every(key=>Array.isArray(pair[key])&&
    pair[key].every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)))))
    throw Error('Bounded calibration line pairs and finite XY coordinates required');
  const result=await runCalibration({mode:'directions',pairs},options);
  if(!Array.isArray(result)||result.length!==pairs.length||result.some(value=>!Number.isFinite(value)||value<0||value>1+1e-12))
    throw Error('Invalid native calibration direction result');
  return result;
}
export async function countHydroCalibrationChains(features,options={}){
  if(!Array.isArray(features)||features.length>10000000)throw Error('Bounded Hydro calibration features required');
  const result=await runCalibration({mode:'chain',features},options),keys=['selectedReachCount','chainCount','sourceCoordinateCount','coordinatesAfterChaining'];
  if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).length!==keys.length||
    keys.some(key=>!Number.isSafeInteger(result[key])||result[key]<0)||result.selectedReachCount>features.length||
    result.chainCount>result.selectedReachCount||result.sourceCoordinateCount!==result.coordinatesAfterChaining)
    throw Error('Invalid native Hydro calibration result');
  return result;
}
export async function optimizeHydroCalibration({kind,stages,regions,weights},options={}){
  if(!['river','lake'].includes(kind)||!Array.isArray(stages)||stages.length!==4||stages.some(x=>!Number.isFinite(x))||
    !Array.isArray(regions)||regions.length>1000||!Array.isArray(weights)||!weights.length||weights.length>1000||
    weights.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(x=>!Number.isFinite(x))))
    throw Error('Explicit Hydro calibration kind, stages, regions and weights required');
  const result=await runCalibration({mode:'optimize',kind,stages,regions,weights},options);
  if(!result||Object.keys(result).sort().join(',')!=='objective,thresholds,weights'||!Array.isArray(result.weights)||
    !weights.some(pair=>pair.every((x,i)=>x===result.weights[i]))||result.weights.length!==2||!Array.isArray(result.thresholds)||
    ![0,4].includes(result.thresholds.length)||result.thresholds.some((x,i)=>!Number.isFinite(x)||(i>0&&x>result.thresholds[i-1]+1e-9))||
    (!result.thresholds.length&&result.objective!==null)||
    (result.objective!==null&&(!Number.isFinite(result.objective)||result.objective<0)))
    throw Error('Invalid native Hydro calibration optimization result');
  return result;
}
export async function assignHydroCalibrationStages({kind,stages,thresholds,weights,features},options={}){
  if(!['river','lake'].includes(kind)||![stages,thresholds].every(row=>Array.isArray(row)&&row.length===4&&row.every(Number.isFinite))||
    !Array.isArray(weights)||weights.length!==2||weights.some(x=>!Number.isFinite(x))||!Array.isArray(features)||features.length>10000000)
    throw Error('Explicit Hydro calibration assignment required');
  const result=await runCalibration({mode:'assign',kind,stages,thresholds,weights,features},options);
  if(!Array.isArray(result)||result.length!==features.length||result.some((value,i)=>
    (value!==null&&!stages.includes(value))||(features[i]?.duplicate===true&&value!==null)))
    throw Error('Invalid native Hydro calibration assignment result');
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    if(process.argv.length!==3||!['--chain-stream','--optimize-stream','--assign-stream','--direction-stream'].includes(process.argv[2]))throw Error('Expected calibration stream operation');
    const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>512*1024*1024)throw Error('Hydro calibration input exceeds byte budget');chunks.push(chunk);}
    const request=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    const result=process.argv[2]==='--direction-stream'?await compareHydroCalibrationDirections(request.pairs,{signal:controller.signal}):
      process.argv[2]==='--chain-stream'?await countHydroCalibrationChains(request.features,{signal:controller.signal}):
      process.argv[2]==='--optimize-stream'?await optimizeHydroCalibration(request,{signal:controller.signal}):
        await assignHydroCalibrationStages(request,{signal:controller.signal});
    console.log(JSON.stringify(result));
  }catch(error){console.error('hydro-calibration: '+error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
