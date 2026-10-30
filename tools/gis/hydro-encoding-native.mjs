import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {verifyNativeTool} from '../native-tool.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
export const hydroEncodingSources=Object.freeze(['tools/cpp/hydro-encoding/CMakeLists.txt','tools/cpp/hydro-encoding/encode.cpp',
  'shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
function geometryBounds(geometry){
  const {type,coordinates}=geometry||{};
  const polygons=type==='LineString'?[[coordinates]]:type==='MultiLineString'||type==='Polygon'?[coordinates]:type==='MultiPolygon'?coordinates:null;
  if(!Array.isArray(polygons))throw Error('Supported Hydro geometry required');
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];let count=0;
  for(const polygon of polygons){if(!Array.isArray(polygon))throw Error('Invalid Hydro geometry');
    for(const line of polygon){if(!Array.isArray(line))throw Error('Invalid Hydro geometry');
      for(const point of line){if(!Array.isArray(point)||point.length<2||!Number.isFinite(point[0])||!Number.isFinite(point[1]))throw Error('Invalid Hydro coordinate');
        let x=(point[0]+180)%360;if(x<0)x+=360;x-=180;if(x===-180)x=180;const y=point[1];
        bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);count++;}}}
  return count?bounds:[-180,-90,180,90];
}
export function prepareHydroEncodingFeatures(features,changedFeatureIds){
  if(!Array.isArray(features)||!Array.isArray(changedFeatureIds)||changedFeatureIds.some(id=>!Number.isSafeInteger(id))||
    new Set(changedFeatureIds).size!==changedFeatureIds.length)throw Error('Explicit Hydro features and changed IDs required');
  const changed=new Set(changedFeatureIds),seen=new Set();
  const prepared=features.map(feature=>{const meta=feature?.metadata,id=meta?.fid;
    if(!Number.isSafeInteger(id)||seen.has(id)||!Array.isArray(meta.bounds)||meta.bounds.length!==4||meta.bounds.some(value=>!Number.isSafeInteger(value)))
      throw Error('Unique Hydro feature and original integer bounds required');
    seen.add(id);
    return {fid:id,logical_fid:meta.logicalFid,pandolab_id:meta.awId,category:meta.category,stage:meta.stage,flags:meta.flags,
      fragment_index:meta.fragmentIndex,fragment_count:meta.fragmentCount,width:meta.width,geometry:feature.geometry,
      bounds:changed.has(id)?geometryBounds(feature.geometry):meta.bounds.map(value=>value/1000000),
      width_profile:feature.widths??null,source_id:meta.sourceId??''};
  });
  if([...changed].some(id=>!seen.has(id)))throw Error('Changed Hydro feature identity is missing');
  return prepared;
}
async function runEncoder(payload,{root=rootDefault,directory=resolve(root,'build-native/hydro-encoding/artifact'),signal}={}){
  signal?.throwIfAborted();const input=JSON.stringify(payload);if(Buffer.byteLength(input)>256*1024*1024)throw Error('Hydro encoding exceeds input budget');
  const executable=process.platform==='win32'?'pando-hydro-encoding.exe':'pando-hydro-encoding';
  const {binary}=verifyNativeTool({root,directory,target:'hydro-encoding',executable,sourceFiles:hydroEncodingSources});
  const output=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:512*1024*1024,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native Hydro encoding failed: '+error.message+' '+stderr,{cause:error})):accept(stdout));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.end(input);
  });
  signal?.throwIfAborted();return JSON.parse(output);
}
export async function encodeHydroFeatures(features,options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(features)||!features.length||features.length>10000)throw Error('Explicit bounded Hydro features required');
  const result=await runEncoder({features},options);
  if(!Array.isArray(result?.features)||result.features.length!==features.length)throw Error('Invalid Hydro encoding result');
  return result.features.map(row=>{
    if(!row||typeof row.featureHex!=='string'||typeof row.sourceIdsHex!=='string'||
      !/^(?:[a-f0-9]{2})+$/.test(row.featureHex)||!/^(?:[a-f0-9]{2})*$/.test(row.sourceIdsHex))throw Error('Invalid Hydro encoded bytes');
    return {feature:Buffer.from(row.featureHex,'hex'),sourceIds:Buffer.from(row.sourceIdsHex,'hex')};
  });
}
export async function encodeHydroGzip(payloads,options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(payloads)||!payloads.length||payloads.length>128||payloads.some(data=>!(data instanceof Uint8Array)||data.length>32*1024*1024))
    throw Error('Explicit bounded Hydro gzip payloads required');
  const input=payloads.map(data=>Buffer.from(data)),result=await runEncoder({mode:'gzip',payloads:input.map(data=>data.toString('hex'))},options);
  if(!Array.isArray(result?.payloads)||result.payloads.length!==input.length)throw Error('Invalid Hydro gzip result');
  return result.payloads.map((hex,index)=>{
    if(typeof hex!=='string'||!/^(?:[a-f0-9]{2})+$/.test(hex))throw Error('Invalid Hydro gzip bytes');
    const bytes=Buffer.from(hex,'hex'),decoded=gunzipSync(bytes,{maxOutputLength:Math.max(1,input[index].length)});
    if(!decoded.equals(input[index]))throw Error('Hydro gzip round-trip differs');return bytes;
  });
}
export async function encodeHydroRepairPlan(plan,options={}){
  if(!Array.isArray(plan?.changedFeatureIds)||!Array.isArray(plan.boundsPendingFor)||
    JSON.stringify(plan.changedFeatureIds)!==JSON.stringify(plan.boundsPendingFor))throw Error('Hydro repair bounds receipt differs');
  const features=prepareHydroEncodingFeatures(plan.features,plan.changedFeatureIds),output=[];
  for(let at=0;at<features.length;at+=128){options.signal?.throwIfAborted();
    const encoded=await encodeHydroFeatures(features.slice(at,at+128),options);
    for(let i=0;i<encoded.length;i++)output.push({fid:features[at+i].fid,logicalFid:features[at+i].logical_fid,...encoded[i]});
  }
  return output;
}
