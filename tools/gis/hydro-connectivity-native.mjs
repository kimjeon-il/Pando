// Source-bound native Hydro connectivity audit. Inputs and originals remain unchanged.
import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {verifyNativeTool} from '../native-tool.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
export const hydroConnectivitySources=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/hydro/connectivity-junctions.cpp',
  'shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
const regions=['eu','as','si','af','sa','na','ar','au','gr'];
const causes=new Set(['missing-downstream','ambiguous-source-parts','original-mismatch','border-alignment','chain-connection']);
export function hydroPartsBySource(features){
  if(!Array.isArray(features))throw Error('Hydro features required');const parts=Object.create(null);
  for(const feature of features){const meta=feature?.metadata;if(meta?.category!=='river')continue;
    const geometry=feature.geometry,lines=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:null;
    if(!Array.isArray(lines)||typeof meta.sourceId!=='string'||!Number.isSafeInteger(meta.fid)||!Number.isSafeInteger(meta.flags)||typeof meta.systemId!=='string')
      throw Error('Invalid Hydro river feature');
    const sources=meta.sourceId.split(',').map(value=>{if(!/^\s*\d+\s*$/.test(value))throw Error('Invalid Hydro source ID');
      const id=Number(value);if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid Hydro source ID');return id;});
    if(sources.length!==lines.length)throw Error('Ambiguous source/part mapping: '+meta.fid);
    for(let index=0;index<sources.length;index++){if(!Array.isArray(lines[index]))throw Error('Invalid Hydro source geometry');
      const key=String(sources[index]);(parts[key]??=[]).push({fid:meta.fid,part:index,points:structuredClone(lines[index]),
        aligned:Boolean(meta.flags&1),system:meta.systemId});}
  }
  return parts;
}
export function validateHydroAudit(result,input){
  if(!result||!result.regions||typeof result.regions!=='object'||!Array.isArray(result.issues)||!Array.isArray(input?.sourceOrder)||!input.raw||
    input.sourceOrder.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(input.sourceOrder).size!==input.sourceOrder.length||
    Object.keys(result.regions).length!==regions.length||regions.some(region=>!result.regions[region]||Array.isArray(result.regions[region])))
    throw Error('Invalid native Hydro audit result');
  const order=new Map(input.sourceOrder.map((id,index)=>[id,index])),seen=new Set(),counts=new Map(regions.map(region=>[region,0]));let last=-1;
  for(const item of result.issues){const index=order.get(item?.source),source=input.raw[item?.source];
    if(index===undefined||index<=last||seen.has(item.source)||!source||source.region!==item.region||source.next!==item.downstream||
      !counts.has(item.region)||!causes.has(item.cause)||typeof item.repairable!=='boolean')throw Error('Invalid native Hydro audit issue');
    if(['original-mismatch','border-alignment','chain-connection'].includes(item.cause)&&
      (!Number.isFinite(item.gapM)||item.gapM<0||!Number.isFinite(item.originalGapM)||item.originalGapM<0||
       !item.upstream||!item.downstreamPart))throw Error('Invalid native Hydro audit geometry');
    last=index;seen.add(item.source);counts.set(item.region,counts.get(item.region)+1);
  }
  for(const region of regions){const stats=result.regions[region];
    if(Object.values(stats).some(value=>!Number.isSafeInteger(value)||value<0)||(stats.issues||0)!==counts.get(region))
      throw Error('Invalid native Hydro audit counts');}
  return result;
}
export function validateHydroRepair(result,{parts,region}){
  if(!result?.parts||!Array.isArray(result.changes)||!parts||typeof region!=='string'||
    !isDeepStrictEqual(Object.keys(result.parts).sort(),Object.keys(parts).sort()))throw Error('Invalid native Hydro repair result');
  const expected=[],actual=[];
  for(const [source,rows] of Object.entries(parts)){
    const returned=result.parts[source];if(!Array.isArray(rows)||!Array.isArray(returned)||rows.length!==returned.length)throw Error('Invalid native Hydro repair geometry');
    for(let i=0;i<rows.length;i++){
      const {points:before,...oldMetadata}=rows[i],{points:after,...newMetadata}=returned[i];
      if(!isDeepStrictEqual(oldMetadata,newMetadata)||!Array.isArray(before)||!Array.isArray(after)||!before.length||before.length!==after.length)
        throw Error('Invalid native Hydro repair geometry or metadata');
      for(let j=0;j<before.length;j++)if(!isDeepStrictEqual(before[j],after[j])){
        if(j!==0&&j!==before.length-1)throw Error('Native Hydro repair changed an interior vertex');
        expected.push(JSON.stringify([oldMetadata.fid,oldMetadata.part,j===0?0:-1,before[j],after[j]]));
      }
    }
  }
  for(const change of result.changes){if(change?.region!==region||![0,-1].includes(change.index)||!Array.isArray(change.before)||!Array.isArray(change.after))
      throw Error('Invalid native Hydro repair receipt');
    actual.push(JSON.stringify([change.fid,change.part,change.index,change.before,change.after]));}
  if(!isDeepStrictEqual(expected.sort(),actual.sort()))throw Error('Native Hydro repair receipts differ from changed endpoints');
  return result;
}
async function runHydroConnectivity(payload,{root=rootDefault,directory=resolve(root,'build-native/hydro-connectivity/artifact'),signal}={}){
  signal?.throwIfAborted();
  const executable=process.platform==='win32'?'pando-hydro-connectivity.exe':'pando-hydro-connectivity';
  const {binary}=verifyNativeTool({root,directory,target:'hydro-connectivity',executable,sourceFiles:hydroConnectivitySources});
  const bytes=JSON.stringify(payload);if(Buffer.byteLength(bytes)>512*1024*1024)throw Error('Hydro connectivity input exceeds byte budget');
  const text=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:512*1024*1024,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native Hydro connectivity failed: '+error.message+' '+stderr,{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.end(bytes);
  });
  signal?.throwIfAborted();return JSON.parse(text);
}
export async function auditHydroParts({parts,raw,sourceOrder},options){
  if(!parts||!raw||!Array.isArray(sourceOrder))throw Error('Explicit Hydro parts, originals and source order required');
  const input={parts,raw,sourceOrder};return validateHydroAudit(await runHydroConnectivity({mode:'audit',...input},options),input);
}
export async function repairHydroParts({parts,raw,region},options){
  if(!parts||!raw||!regions.includes(region))throw Error('Explicit Hydro parts, originals and region required');
  const input={parts,raw,region};return validateHydroRepair(await runHydroConnectivity(input,options),input);
}
export async function auditHydroFeatures({features,raw,sourceOrder},options){
  return auditHydroParts({parts:hydroPartsBySource(features),raw,sourceOrder},options);
}
