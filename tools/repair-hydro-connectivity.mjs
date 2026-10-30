// Build a verified private Hydro repair without overwriting existing data.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {reportArgument} from './report-paths.mjs';
import {hydroSourceArchivesFromManifest} from './gis/hydro-source-reader.mjs';
import {hydroBaselineFingerprintFromDocument} from './gis/hydro-manifest-fingerprint.mjs';
import {buildVerifiedHydroRepair} from './gis/hydro-repair-pipeline.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function entryExists(path){try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function inside(parent,path){const rel=relative(parent,path);return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));}
function physicalCandidate(path){
  let cursor=resolve(path),suffix=[];
  while(!existsSync(cursor)){const parent=dirname(cursor);if(parent===cursor)throw Error('Cannot resolve Hydro output parent');
    suffix.unshift(basename(cursor));cursor=parent;}
  return resolve(realpathSync(cursor),...suffix);
}
function outputPath(value){
  if(typeof value!=='string'||!value)throw Error('Explicit Hydro staging output required');
  const path=resolve(value),physical=physicalCandidate(path);
  if(inside(realpathSync(root),physical))throw Error('Hydro output must be outside the repository');
  if(entryExists(path))throw Error('Hydro output already exists; preserve it');return path;
}
function newReport(value){
  if(typeof value!=='string'||!value)throw Error('Explicit Hydro repair report required');
  const path=resolve(reportArgument(value,{access:'write'}));
  if(entryExists(path))throw Error('Hydro report already exists; preserve it');return path;
}
export async function repairHydroConnectivity({baseline:baselineValue,sources,output:outputValue,report:reportValue}){
  if(!baselineValue||!sources)throw Error('Hydro baseline and source directory are required');
  const output=outputPath(outputValue),report=newReport(reportValue);
  if(inside(physicalCandidate(output),physicalCandidate(report)))throw Error('Hydro report must be outside the staging output');
  const baselinePath=resolve(reportArgument(baselineValue,{access:'read'})),baselineBytes=readFileSync(baselinePath),baseline=JSON.parse(baselineBytes);
  const originalHash=sha(baselineBytes),manifest=baseline?.manifest;
  if(!Array.isArray(baseline?.features)||!baseline.features.length||!manifest?.stats||!manifest?.cache||typeof manifest.version!=='string')
    throw Error('Hydro baseline manifest and features are required');
  if(baseline.features.some((row,index)=>index&&row?.metadata?.fid<=baseline.features[index-1]?.metadata?.fid))
    throw Error('Hydro baseline features must be ordered by identity');
  const archives=hydroSourceArchivesFromManifest(manifest,sources);
  const result=await buildVerifiedHydroRepair({baseline,archives},{
    connectivityDirectory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,encodingDirectory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY});
  if(sha(readFileSync(baselinePath))!==originalHash)throw Error('Hydro baseline changed during repair');
  outputPath(output);newReport(report);
  const stagedManifest=structuredClone(manifest);delete stagedManifest.container;
  stagedManifest.index=result.pack.layout.index;stagedManifest.metadata=result.pack.layout.metadata;stagedManifest.shards=result.pack.layout.shards;
  Object.assign(stagedManifest.stats,result.pack.stats);
  stagedManifest.cache.name=`pandolab-water-v${stagedManifest.version}-${stagedManifest.index.sha256.slice(0,12)}`;
  const initialIssues=Object.values(result.plan.baselineRegions).reduce((sum,row)=>sum+(row.issues||0),0);
  stagedManifest.connectivity={revision:1,repairedConnections:initialIssues-result.plan.remaining.length,unresolvedConnections:result.plan.remaining.length};
  const receipt={baselineRegions:result.plan.baselineRegions,regions:result.plan.regions,changes:result.plan.changes,
    remaining:result.plan.remaining,changedFeatureIds:result.plan.changedFeatureIds,unchangedFeatureCount:result.plan.unchangedFeatureCount,
    baselineManifestFingerprint:hydroBaselineFingerprintFromDocument(baselineBytes.toString('utf8')),serializedVerification:result.verification};
  mkdirSync(dirname(output),{recursive:true});mkdirSync(output);
  for(const [path,bytes] of result.pack.files){
    if(!/^(?:index\.bin\.gz|metadata-(?:core|detail)\.json\.gz|shards\/s\d+\.bin)$/.test(path))throw Error('Invalid Hydro output path');
    const target=resolve(output,path);if(!inside(output,target))throw Error('Hydro output path escaped staging');
    mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});
  }
  const manifestBytes=Buffer.from(JSON.stringify(stagedManifest,null,2)+'\n'),reportBytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');
  writeFileSync(resolve(output,'manifest.json'),manifestBytes,{flag:'wx'});
  mkdirSync(dirname(report),{recursive:true});writeFileSync(report,reportBytes,{flag:'wx'});
  for(const [path,bytes] of result.pack.files)if(sha(readFileSync(resolve(output,path)))!==sha(bytes))throw Error('Written Hydro output changed: '+path);
  if(!lstatSync(report).isFile()||!readFileSync(report).equals(reportBytes)||
    !readFileSync(resolve(output,'manifest.json')).equals(manifestBytes))throw Error('Written Hydro manifest or report changed');
  return {output,report,features:baseline.features.length,changedFeatures:result.plan.changedFeatureIds.length,
    repairedConnections:stagedManifest.connectivity.repairedConnections,unresolvedConnections:result.plan.remaining.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values}=parseArgs({options:{baseline:{type:'string'},sources:{type:'string'},output:{type:'string'},report:{type:'string'}}});
    console.log(JSON.stringify(await repairHydroConnectivity(values)));}
  catch(error){console.error('hydro-repair: '+error.message);process.exitCode=1;}
}
