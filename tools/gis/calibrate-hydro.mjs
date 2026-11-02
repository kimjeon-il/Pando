// Analysis-only Hydro calibration. It does not modify runtime map assets.
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,realpathSync} from 'node:fs';
import {readFile,mkdir} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {writeLibraryOutput} from '../library-data.mjs';
import {reportArgument} from '../report-paths.mjs';
import {fingerprintHydroCalibrationFile,loadHydroCalibrationReferences,prepareHydroCalibrationSourceFiles} from './hydro-calibration-input.mjs';
import {runHydroCalibration} from './hydro-calibration-preparation.mjs';
import {renderHydroCalibrationComparison} from './hydro-calibration-image.mjs';
import {renderCalibrationReport} from './hydro-calibration-report.mjs';

const workspace=fileURLToPath(new URL('../../',import.meta.url));
export const hydroCalibrationRegions=Object.freeze([
  {id:'europe',label:'유럽',bbox:[-11,35,31,72],riverCode:'eu',riverLayer:'rivers_europe',lakeLayer:'lakes_europe',calibrate:true},
  {id:'north-america',label:'북미',bbox:[-130,24,-65,55],riverCode:'na',riverLayer:'rivers_north_america',lakeLayer:'lakes_north_america',calibrate:true},
  {id:'australia',label:'호주',bbox:[112,-44,154,-10],riverCode:'au',riverLayer:'rivers_australia',lakeLayer:'lakes_australia',calibrate:true},
  {id:'korea',label:'한반도',bbox:[124,33,132,43],riverCode:'as',riverLayer:'rivers_base',lakeLayer:'lakes_base',calibrate:false}
]);
const inside=(base,path)=>{const rel=relative(base,path);return !rel||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function executeHydroCalibration(input,{pointScreen={},calibration={},preview={},image={},signal}={}){
  signal?.throwIfAborted();const {riverRoots,hydrolakes,naturalEarthRoot,output,regularFont,boldFont,regions=hydroCalibrationRegions}=structuredClone(input??{});
  if(!Array.isArray(riverRoots)||!riverRoots.length||typeof hydrolakes!=='string'||typeof naturalEarthRoot!=='string'||
    typeof output!=='string'||!output||typeof regularFont!=='string'||typeof boldFont!=='string'||!Array.isArray(regions)||!regions.length||
    regions.some(region=>typeof region?.id!=='string'||!/^[A-Za-z0-9_-]+$/.test(region.id)))throw Error('Explicit Hydro calibration inputs and output required');
  const target=resolve(reportArgument(output,{access:'write',root:workspace})),earth=realpathSync(resolve(naturalEarthRoot));
  const assets=dirname(earth),workspaceAssets=resolve(workspace,'assets/data');
  if(inside(assets,target)||inside(workspaceAssets,target))throw Error('Hydro calibration output must be outside runtime data');
  if(existsSync(target))throw Error('Hydro calibration output already exists');
  mkdirSync(dirname(target),{recursive:true});const physicalTarget=join(realpathSync(dirname(target)),basename(target));
  const physicalAssets=existsSync(workspaceAssets)?realpathSync(workspaceAssets):workspaceAssets;
  if(inside(assets,physicalTarget)||inside(physicalAssets,physicalTarget))throw Error('Hydro calibration output must be outside runtime data');
  const reference=await loadHydroCalibrationReferences({root:earth,regions,signal});
  const source=await prepareHydroCalibrationSourceFiles({riverRoots,hydrolakes,regions,signal});
  const [regular,bold]=await Promise.all([fingerprintHydroCalibrationFile(regularFont,signal),fingerprintHydroCalibrationFile(boldFont,signal)]);
  const fonts={regular:{file:regular.path,sha256:regular.sha256},bold:{file:bold.path,sha256:bold.sha256}};
  const sources={...source.sources,naturalEarth:reference.sourceFiles,fonts:{regular:{file:basename(regular.path),sha256:regular.sha256},
    bold:{file:basename(bold.path),sha256:bold.sha256}}};
  const analysis=await runHydroCalibration({archives:source.archives,lakeFiles:source.lakeFiles,regions,references:reference.references,
    representativeSource:reference.representativeSource,sources},{pointScreen,calibration,signal});
  const entries=[{name:'results.json',data:Buffer.from(JSON.stringify(analysis.results,null,2)+'\n')},
    {name:'README.md',data:Buffer.from(renderCalibrationReport(analysis.results))}];
  for(const data of analysis.regions){const refs=reference.references[data.region.id];
    const picture=await renderHydroCalibrationComparison({...data,...refs,fonts},{pointScreen,preview,image,signal});
    entries.push({name:`${data.region.id}.png`,data:picture.data});}
  signal?.throwIfAborted();await mkdir(physicalTarget);const files=[];
  for(const entry of entries){signal?.throwIfAborted();const path=join(physicalTarget,entry.name);
    writeLibraryOutput(path,entry.data,{flag:'wx'});const stored=await readFile(path,{signal}),sha256=digest(entry.data);
    if(digest(stored)!==sha256)throw Error('Hydro calibration output verification failed: '+entry.name);
    files.push({name:entry.name,bytes:stored.length,sha256});}
  return {output:physicalTarget,files,acceptance:analysis.results.acceptance};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{'hydrorivers-root':{type:'string',multiple:true},hydrolakes:{type:'string'},
    'natural-earth-root':{type:'string'},output:{type:'string'},'regular-font':{type:'string'},'bold-font':{type:'string'}}});
    if(positionals.length||!values['hydrorivers-root']?.length||!values.hydrolakes||!values['natural-earth-root']||!values.output)
      throw Error('Expected --hydrorivers-root, --hydrolakes, --natural-earth-root and --output');
    const windows=process.platform==='win32',regularFont=values['regular-font']||(windows?'C:/Windows/Fonts/malgun.ttf':'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
      boldFont=values['bold-font']||(windows?'C:/Windows/Fonts/malgunbd.ttf':'/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf');
    const pointScreen={};if(process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY)pointScreen.directory=process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY;
    if(process.env.PANDO_HYDRO_RUNTIME_ROOT)pointScreen.runtimeRoot=process.env.PANDO_HYDRO_RUNTIME_ROOT;
    const result=await executeHydroCalibration({riverRoots:values['hydrorivers-root'],hydrolakes:values.hydrolakes,
      naturalEarthRoot:values['natural-earth-root'],output:values.output,regularFont,boldFont},{pointScreen,signal:controller.signal});
    console.log(JSON.stringify(result));
  }catch(error){console.error('calibrate-hydro: '+error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
