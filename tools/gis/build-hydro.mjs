// Generate a new private Hydro pack from explicitly supplied source originals.
import {createHash} from 'node:crypto';
import {existsSync,realpathSync} from 'node:fs';
import {mkdir,readFile,realpath,stat} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {writeLibraryOutput} from "../data/library-runtime.mjs";
import {prepareHydroRiverSources} from './hydro-calibration-input.mjs';
import {readPhysicalRaster} from './physical-raster-native.mjs';
import {createHydroWaterRasterSampler} from './hydro-outlets.mjs';
import {parseHydroOsmWaterways} from './hydro-osm-waterway.mjs';
import {generateHydroFromSources} from './hydro-generation-pipeline.mjs';

const workspace=fileURLToPath(new URL('../../',import.meta.url)),defaultCodes=['af','ar','as','au','eu','gr','na','sa','si'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(base,path)=>{const rel=relative(base,path);return !rel||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);};
async function stableJson(path,signal){
  const actual=await realpath(path),before=await stat(actual);if(!before.isFile()||before.size>128*1024*1024)throw Error('Bounded Hydro JSON source required');
  const bytes=await readFile(actual,{signal}),after=await stat(actual);
  if(bytes.length!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino||before.dev!==after.dev)
    throw Error('Hydro JSON source changed while reading');return {path:actual,sha256:digest(bytes),value:JSON.parse(bytes.toString('utf8'))};
}
const evidence=item=>({file:basename(item.path),sha256:item.sha256});
const collection=item=>{if(item.value?.type!=='FeatureCollection'||!Array.isArray(item.value.features))throw Error('Hydro source FeatureCollection required');
  return item.value.features;};
export async function executeHydroGeneration(input,options={}){
  options.signal?.throwIfAborted();const {riverRoots,naturalEarthRoot,raster,output,osmPath,overridesPath,independentPath}=input??{},codes=options.codes??defaultCodes;
  if(!Array.isArray(riverRoots)||!riverRoots.length||[naturalEarthRoot,raster,output].some(value=>typeof value!=='string'||!value))
    throw Error('Explicit Hydro source roots, raster and new output required');
  if(typeof independentPath!=='string'||!independentPath)throw Error('Explicit independent-hydronym-replacements recipe required.');
  const earth=await realpath(naturalEarthRoot),target=resolve(output),workspaceAssets=resolve(workspace,'assets/data');
  if(existsSync(target))throw Error('Hydro generation output already exists');
  if(inside(dirname(earth),target)||inside(workspaceAssets,target))throw Error('Hydro output must be outside runtime data');
  await mkdir(dirname(target),{recursive:true});const physicalTarget=join(await realpath(dirname(target)),basename(target)),
    physicalAssets=existsSync(workspaceAssets)?realpathSync(workspaceAssets):workspaceAssets;
  if(inside(dirname(earth),physicalTarget)||inside(physicalAssets,physicalTarget))throw Error('Hydro output must be outside runtime data');
  const [river,lake,country,overrides,independent,osm]=await Promise.all([
    stableJson(join(earth,'rivers_base.geojson'),options.signal),stableJson(join(earth,'lakes_base.geojson'),options.signal),
    stableJson(join(dirname(earth),'countries-ne-5.1.1.geojson'),options.signal),
    stableJson(overridesPath||join(earth,'hydronym-ko-overrides.json'),options.signal),
    stableJson(independentPath,options.signal),
    osmPath?stableJson(osmPath,options.signal):null]);
  const references=collection(river),lakes=collection(lake),countries=collection(country).map((row,index)=>({id:String(row.id||index),geometry:row.geometry})),
    aliases=overrides.value?.aliases||{},systemOverrides=overrides.value?.systems||{},osmRows=osm?parseHydroOsmWaterways(osm.value,{aliases}):[];
  const sources=await prepareHydroRiverSources({riverRoots,codes,signal:options.signal}),physical=await readPhysicalRaster(raster,{...options.physical,signal:options.signal});
  if(physical.mode!=='RGB')throw Error('Hydro water raster must contain RGB source pixels');
  const sampleWater=createHydroWaterRasterSampler({width:physical.width,height:physical.height,data:physical.pixels}),
    source={naturalEarthNameReference:[evidence(river),evidence(lake),evidence(country)],drainageFreeWaterMask:{file:basename(raster),sha256:physical.sha256},
      naturalEarthLakes:{...evidence(lake),selected:0},osmWaterways:osm?{...evidence(osm),matchedSystems:0,license:'ODbL'}:
        {file:null,matchedSystems:0,license:'ODbL'},hydronymOverrides:evidence(overrides),
      independentHydronymReplacements:{...evidence(independent),replacedSystems:0,geometryChanged:false}};
  const generated=await generateHydroFromSources({sources,countries,references,lakes,sampleWater,aliases,systemOverrides,
    independentDocument:independent.value,osmRows,source},options),manifest=Buffer.from(JSON.stringify(generated.manifest,null,2));
  if(manifest.length>100*1024)throw Error('Hydro manifest exceeds 100 KiB');
  options.signal?.throwIfAborted();await mkdir(physicalTarget);const entries=[...generated.pack.files,['manifest.json',manifest]];
  const files=[];for(const [name,bytes] of entries){const path=join(physicalTarget,name);
    options.signal?.throwIfAborted();await mkdir(dirname(path),{recursive:true});writeLibraryOutput(path,bytes,{flag:'wx'});
    const stored=await readFile(path,{signal:options.signal}),sha256=digest(bytes);if(stored.length!==bytes.length||digest(stored)!==sha256)
      throw Error('Hydro output verification failed: '+name);files.push({name,bytes:stored.length,sha256});}
  return {output:physicalTarget,files,stats:generated.manifest.stats};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{'hydrorivers-root':{type:'string',multiple:true},
    'natural-earth-root':{type:'string'},'drainage-free-raster':{type:'string'},output:{type:'string'},'osm-waterways':{type:'string'},
    'hydronym-overrides':{type:'string'},'independent-hydronym-replacements':{type:'string'}}});
    if(positionals.length||!values['hydrorivers-root']?.length||!values['natural-earth-root']||!values['drainage-free-raster']||!values.output)
      throw Error('Expected --hydrorivers-root, --natural-earth-root, --drainage-free-raster and --output');
    const pointScreen={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},
      connectivity={directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},encoding={directory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY},
      physical={directory:process.env.PANDO_PHYSICAL_RASTER_DIRECTORY};
    const result=await executeHydroGeneration({riverRoots:values['hydrorivers-root'],naturalEarthRoot:values['natural-earth-root'],
      raster:values['drainage-free-raster'],output:values.output,osmPath:values['osm-waterways'],overridesPath:values['hydronym-overrides'],
      independentPath:values['independent-hydronym-replacements']},{pointScreen,connectivity,encoding,physical,signal:controller.signal,
      onRegion:row=>process.stderr.write(`[${row.code}] ${row.systems} systems, ${row.chains} chains\n`)});
    console.log(JSON.stringify(result));
  }catch(error){console.error('build-hydro: '+error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
