// Audit selected Hydro connections using pinned source ZIPs and the native engine.
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {auditHydroSourceArchives} from './gis/hydro-connectivity-native.mjs';
import {hydroSourceArchivesFromManifest} from './gis/hydro-source-reader.mjs';
import {hydroBaselineAuditFingerprintFromDocument} from './gis/hydro-manifest-fingerprint.mjs';
import {reportArgument} from './report-paths.mjs';

function exists(path){try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function auditHydroConnectivity({baseline:input,sources,report:reportValue}){
  if(!input||!sources||!reportValue)throw Error('Hydro baseline, sources and report are required');
  const baselinePath=resolve(reportArgument(input,{access:'read'})),report=resolve(reportArgument(reportValue,{access:'write'}));
  if(exists(report))throw Error('Hydro audit report already exists; preserve it');
  const baselineBytes=readFileSync(baselinePath),baseline=JSON.parse(baselineBytes),hash=sha(baselineBytes);
  const archives=hydroSourceArchivesFromManifest(baseline.manifest,sources);
  const options=process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY?{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}:{};
  const result=await auditHydroSourceArchives({features:baseline.features,archives},options);
  if(sha(readFileSync(baselinePath))!==hash)throw Error('Hydro baseline changed during audit');
  const receipt={...result,baselineManifestSha256:hydroBaselineAuditFingerprintFromDocument(baselineBytes.toString('utf8'))};
  mkdirSync(dirname(report),{recursive:true});writeFileSync(report,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return result.regions;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values}=parseArgs({options:{baseline:{type:'string'},sources:{type:'string'},report:{type:'string'}}});
    console.log(JSON.stringify(await auditHydroConnectivity(values),null,2));}
  catch(error){console.error('hydro-audit: '+error.message);process.exitCode=1;}
}
