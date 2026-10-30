// Verify a decoded staged Hydro pack without extracting or modifying source archives.
import {createHash,randomUUID} from 'node:crypto';
import {lstatSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {verifyHydroStaged} from './gis/hydro-connectivity-native.mjs';
import {reportArgument} from './report-paths.mjs';

const regions=['eu','as','si','af','sa','na','ar','au','gr'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyHydroConnectivity({baseline:baselinePath,staged:stagedPath,sources,report:reportPath}){
  if(!baselinePath||!stagedPath||!sources||!reportPath)throw Error('Baseline, staged pack, sources and report are required');
  const baseline=JSON.parse(readFileSync(baselinePath,'utf8')),staged=JSON.parse(readFileSync(stagedPath,'utf8'));
  const reportFile=resolve(reportArgument(reportPath,{access:'write'}));
  if(!lstatSync(reportFile).isFile())throw Error('Hydro report must be a regular file');
  const reportBytes=readFileSync(reportFile),report=JSON.parse(reportBytes),specs=baseline?.manifest?.sources?.hydroRivers;
  if(!Array.isArray(specs)||specs.length!==regions.length||new Set(specs.map(spec=>spec?.datasetCode)).size!==regions.length||
    regions.some(region=>!specs.some(spec=>spec.datasetCode===region)))throw Error('Complete Hydro source specifications required');
  const archives=regions.map(code=>({archive:resolve(sources,`HydroRIVERS_v10_${code}_shp.zip`),
    specification:specs.find(spec=>spec.datasetCode===code)}));
  const options=process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY?{directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY}:{};
  const verification=await verifyHydroStaged({baseline,staged,report,archives},options);
  if(!lstatSync(reportFile).isFile()||digest(readFileSync(reportFile))!==digest(reportBytes))throw Error('Hydro report changed during verification');
  const result={...report,serializedVerification:verification};
  const temporary=resolve(dirname(reportFile),'.'+basename(reportFile)+'.'+randomUUID()+'.pending');
  writeFileSync(temporary,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  renameSync(temporary,reportFile);
  return verification;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{baseline:{type:'string'},staged:{type:'string'},sources:{type:'string'},report:{type:'string'}}});
    console.log(JSON.stringify(await verifyHydroConnectivity(values),null,2));
  }catch(error){console.error('hydro-connectivity: '+error.message);process.exitCode=1;}
}
