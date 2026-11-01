// Explicit candidate-only entry point for Natural Earth physical data.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {buildPhysicalHydro} from './gis/build-physical-hydro.mjs';
import {buildPhysicalTerrain} from './gis/build-physical-terrain.mjs';

export async function buildPhysicalData(argv=process.argv.slice(2)){
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,options:{
    'hydro-only':{type:'boolean'},'terrain-only':{type:'boolean'},countries:{type:'string'},
  }});
  if(positionals.length!==2||values['hydro-only']&&values['terrain-only'])
    throw Error('Expected SOURCE_ROOT OUTPUT_ROOT and at most one of --hydro-only or --terrain-only');
  const [sourceRoot,outputRoot]=positionals.map(value=>resolve(value));
  if(!values['terrain-only'])buildPhysicalHydro({sourceRoot,outputRoot});
  if(!values['hydro-only'])await buildPhysicalTerrain({sourceRoot,outputRoot,
    countriesPath:resolve(values.countries||resolve(outputRoot,'territorial-entities/generated/current-world.geojson'))});
  return {sourceRoot,outputRoot};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await buildPhysicalData();console.log(JSON.stringify({output:result.outputRoot}));}
  catch(error){console.error('build-physical-data: '+error.message);process.exitCode=1;}
}
