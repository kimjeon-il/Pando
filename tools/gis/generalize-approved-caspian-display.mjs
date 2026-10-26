#!/usr/bin/env node
/** Approved 1922 Caspian ZIP -> native GEOS display generalization candidate.
 * Deliberately does NOT publish/overwrite runtime geometry or historic archives.
 */
import {spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync,constants as fsConstants}
  from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {zipMembers,zipMemberChunks} from '../lib/geonames-zip.mjs';
import {approvedNetworkBytes,ARCHIVE_SHA,MEMBER_SHA,MEMBER}
  from './verify-approved-caspian-network.mjs';
import {digest} from './verify-historical-linework.mjs';

export const WATER_MEMBER='caspian-completion/assembled-completion-candidate/polygon-check/waterbody-polygon-candidate.geojson';
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const canonical=value=>JSON.stringify(sortJson(value));
const sortJson=value=>Array.isArray(value)?value.map(sortJson):
  value&&typeof value==='object'?Object.fromEntries(Object.keys(value)
    .sort().map(k=>[k,sortJson(value[k])])):value;
async function zipMemberBytes(path,name,maxBytes=64*1024*1024){
  const members=(await zipMembers(path)).filter(m=>m.name===name);
  requireValue(members.length===1,'Expected exactly one source ZIP member: '+name);
  let total=0;
  const buffers=[];
  for await(const chunk of zipMemberChunks(path,members[0])){
    total+=chunk.length;
    requireValue(total<=maxBytes,'Approved ZIP member exceeds decompression cap');
    buffers.push(chunk);
  }
  return Buffer.concat(buffers);
}
export function geometryFromDocument(value){
  if(value?.type==='FeatureCollection'){
    requireValue(value.features?.length===1,'Approved water candidate needs one polygon');
    return geometryFromDocument(value.features[0]);
  }
  if(value?.type==='Feature')return geometryFromDocument(value.geometry);
  requireValue(value?.type==='Polygon'&&Array.isArray(value.coordinates),
    'Expected original Polygon waterbody reference');
  return value;
}
export const holes=geometry=>geometry.type==='Polygon'
  ?geometry.coordinates.length-1
  :geometry.type==='MultiPolygon'
    ?geometry.coordinates.reduce((sum,polygon)=>sum+polygon.length-1,0)
    :NaN;
export async function inputFromPinnedCaspianZip(zip,{
  expectedArchiveSha=ARCHIVE_SHA,
  expectedMemberSha=MEMBER_SHA,
  expectedFeatures=266,
  expectedHoles=68,
}={}){
  const original=await approvedNetworkBytes(zip,{
    expectedArchiveSha,expectedMemberSha,expectedFeatures,
  });
  const waterBytes=await zipMemberBytes(zip,WATER_MEMBER);
  const network=JSON.parse(original.bytes.toString('utf8'));
  const water=geometryFromDocument(JSON.parse(waterBytes.toString('utf8')));
  requireValue(holes(water)===expectedHoles,
    'Approved reference waterbody hole count changed');
  return {
    input:{network,water,expectedHoles},
    source:{
      archiveSha256:expectedArchiveSha,networkSha256:expectedMemberSha,
      waterMemberSha256:digest(waterBytes),networkFeatures:expectedFeatures,
      waterHoles:expectedHoles,
    },
  };
}
export function validateDisplayCandidate(input,output){
  requireValue(output?.network?.type==='FeatureCollection'
    &&Array.isArray(output.network.features)
    &&output.network.features.length===input.network.features.length,
    'Native output did not preserve the feature count');
  requireValue(output?.water?.type==='MultiPolygon'
    &&holes(output.water)===input.expectedHoles,
    'Native generalization changed the approved waterbody hole topology');
  requireValue(output?.metrics?.holesAfter===input.expectedHoles
    &&output.metrics.holesBefore===input.expectedHoles
    &&output.metrics.nonEndpointIntersections===0
    &&Number.isFinite(output.metrics.boundaryHausdorffMeters)
    &&output.metrics.adaptiveLocalRepairs>=0,
    'Native Caspian output metrics violate pinned topology');
  requireValue(output.metrics.verticesAfter<=output.metrics.verticesBefore,
    'Historical display generalization increased geometry complexity');
  for(let i=0;i<input.network.features.length;i++){
    const before=input.network.features[i],after=output.network.features[i];
    requireValue(after.id===before.id
      &&canonical(after.properties)===canonical(before.properties),
      'Native generalization changed historical source identity or provenance: '+i);
    const first=before.geometry.coordinates[0],last=before.geometry.coordinates.at(-1);
    requireValue(JSON.stringify(after.geometry.coordinates[0])===JSON.stringify(first)
      &&JSON.stringify(after.geometry.coordinates.at(-1))===JSON.stringify(last),
      'Native generalization changed an approved network junction: '+i);
    const tolerance=output.metrics.perFeatureToleranceMeters[i]?.tolerance;
    requireValue(Number.isFinite(tolerance)&&tolerance>=0,
      'Invalid native Caspian source-specific tolerance');
    if(tolerance===0)
      requireValue(canonical(after.geometry)===canonical(before.geometry),
        'Protected historical role/line moved: '+i);
  }
  return {
    verticesBefore:output.metrics.verticesBefore,
    verticesAfter:output.metrics.verticesAfter,
    holesBefore:output.metrics.holesBefore,
    holesAfter:output.metrics.holesAfter,
    areaBeforeKm2:output.metrics.areaBeforeKm2,
    areaAfterKm2:output.metrics.areaAfterKm2,
    boundaryHausdorffMeters:output.metrics.boundaryHausdorffMeters,
    adaptiveLocalRepairs:output.metrics.adaptiveLocalRepairs,
    nonEndpointIntersections:0,
  };
}
export async function generateApprovedCaspianDisplay(zip,{
  binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY,
  output=null,expectedArchiveSha=ARCHIVE_SHA,
  expectedMemberSha=MEMBER_SHA,expectedFeatures=266,expectedHoles=68,
}={}){
  requireValue(binary&&existsSync(binary),'Native historical GEOS/PROJ tool unavailable');
  const {input,source}=await inputFromPinnedCaspianZip(zip,{
    expectedArchiveSha,expectedMemberSha,expectedFeatures,expectedHoles,
  });
  const temp=mkdtempSync(join(tmpdir(),'pando-historical-caspian-display-'));
  try{
    const request=join(temp,'request.json'),generated=join(temp,'derived.json');
    writeFileSync(request,JSON.stringify(input),{flag:'wx'});
    const result=spawnSync(binary,['--generalize-caspian',request,generated],{
      encoding:'utf8',maxBuffer:3*1024*1024,
    });
    if(result.error||result.status!==0)
      throw Error('Native Caspian display generalization failed: '+
        (result.stderr||result.error?.message||result.status));
    const derived=JSON.parse(readFileSync(generated,'utf8'));
    const metrics=validateDisplayCandidate(input,derived);
    requireValue(digest(readFileSync(zip))===expectedArchiveSha,
      'Approved original ZIP was changed during native Caspian generalization');
    if(output){
      requireValue(!existsSync(output),'Refusing to replace an existing display candidate');
      copyFileSync(generated,output,fsConstants.COPYFILE_EXCL);
    }
    return {schema:'pando-approved-caspian-display-native-candidate-v1',
      status:'review-only-not-approved-for-runtime',
      original:source,metrics,
      derivedSha256:digest(readFileSync(generated)),
      output:output?resolve(output):null,
      sourceZipUnchanged:true};
  } finally {rmSync(temp,{recursive:true,force:true});}
}
export async function main(args=process.argv.slice(2)){
  let zip=null,output=null;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--zip'&&args[i+1]&&!zip)zip=args[++i];
    else if(args[i]==='--output'&&args[i+1]&&!output)output=args[++i];
    else throw Error('Usage: --zip APPROVED_ZIP [--output NEW_PRIVATE_DERIVATIVE]');
  }
  requireValue(zip,'Approved source ZIP required');
  const receipt=await generateApprovedCaspianDisplay(zip,{output});
  console.log('CASPIAN_1922_NATIVE_DISPLAY='+JSON.stringify(receipt));
  return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error('caspian-native-display: '+error.message);process.exitCode=1;});
