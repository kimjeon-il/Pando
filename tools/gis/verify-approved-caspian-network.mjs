#!/usr/bin/env node
/** Immutable USSR 1922 Caspian source ZIP -> CRC and SHA verified native GEOS topology.
 * Never materializes an approved national border or writes back to library storage.
 */
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {zipMembers,zipMemberChunks} from '../lib/geonames-zip.mjs';
import {verifyHistoricalLinework,digest} from './verify-historical-linework.mjs';

export const ARCHIVE_NAME='caspian-shoreline-completed-candidate-20261024.zip';
export const ARCHIVE_SHA='3df45ab6e7d3a4b1dfac42b29f28cc1c932c3b1be9f866ccd7df6bb769b9a5b4';
export const MEMBER='caspian-completion/assembled-completion-candidate/waterbody-boundary-network.geojson';
export const MEMBER_SHA='f6fce5c05021ae8fa080d8bf350a73aa1f4d4e1016e2a1dfffcc49809fc7361e';

export async function approvedNetworkBytes(zipPath,{
  expectedArchiveSha=ARCHIVE_SHA,expectedMemberSha=MEMBER_SHA,
  expectedFeatures=266,
}={}){
  const source=readFileSync(resolve(zipPath));
  if(digest(source)!==expectedArchiveSha)
    throw Error('Pinned Caspian ZIP SHA-256 mismatch');
  const candidates=(await zipMembers(zipPath)).filter(e=>e.name===MEMBER);
  if(candidates.length!==1)throw Error('Expected exactly one approved network member');
  const entry=candidates[0],parts=[];
  let total=0;
  for await(const chunk of zipMemberChunks(zipPath,entry)){
    total+=chunk.length;
    if(total>64*1024*1024)throw Error('Caspian ZIP network member too large');
    parts.push(chunk);
  }
  const bytes=Buffer.concat(parts);
  if(digest(bytes)!==expectedMemberSha)throw Error('Approved Caspian network SHA-256 mismatch');
  const payload=JSON.parse(bytes.toString('utf8'));
  if(payload?.type!=='FeatureCollection'||!Array.isArray(payload.features)
    ||payload.features.length!==expectedFeatures
    ||payload.features.some(f=>f.geometry?.type!=='LineString'
      ||!Array.isArray(f.geometry.coordinates)||f.geometry.coordinates.length<2))
    throw Error('Unexpected approved 1922 Caspian 266-segment topology');
  return {bytes,features:payload.features.length,
    zipSha256:expectedArchiveSha,memberSha256:expectedMemberSha};
}
export async function verifyApprovedCaspianNetwork(zipPath,{
  expectedArchiveSha=ARCHIVE_SHA,expectedMemberSha=MEMBER_SHA,expectedFeatures=266,
  binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY,
}={}){
  const data=await approvedNetworkBytes(zipPath,{expectedArchiveSha,expectedMemberSha,expectedFeatures});
  const tmp=mkdtempSync(join(tmpdir(),'pando-c1-caspian-'));
  try{
    const input=join(tmp,'historical-network.geojson');
    writeFileSync(input,data.bytes,{flag:'wx'});
    const proof=verifyHistoricalLinework(input,expectedMemberSha,binary);
    if(proof.featureCount!==expectedFeatures)
      throw Error('Unexpected Caspian 1922 verified network count');
    if(digest(readFileSync(zipPath))!==expectedArchiveSha)
      throw Error('Caspian original ZIP was modified');
    return {schema:'pando-c1-approved-1922-caspian-network-v1',
      archiveName:ARCHIVE_NAME,archiveSha256:expectedArchiveSha,
      sourceMember:MEMBER,sourceMemberSha256:expectedMemberSha,
      featureCount:proof.featureCount,endpointTouchPairs:proof.endpointTouchPairs,
      nonEndpointCrossings:0,sourceBytesUnchanged:true,topologyVerified:true,
      historicalAreaOrSovereigntyApproved:false};
  } finally {rmSync(tmp,{recursive:true,force:true});}
}
export async function main(argv=process.argv.slice(2)){
  if(argv.length!==2||argv[0]!=='--zip')
    throw Error('Usage: --zip PINNED_CASPIAN_ARCHIVE (with PANDO_TERRITORIAL_RECIPE_BINARY)');
  const result=await verifyApprovedCaspianNetwork(argv[1]);
  console.log('CASPIAN_1922_NATIVE_NETWORK_PARITY='+JSON.stringify(result));
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error('caspian-native: '+error.message);process.exitCode=1;});
