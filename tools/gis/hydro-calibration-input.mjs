// Read only the Natural Earth layers explicitly used by the selected calibration regions.
import {createHash} from 'node:crypto';
import {readFile,realpath,stat} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {selectHydroCalibrationReferences} from './hydro-calibration-preparation.mjs';

export async function loadHydroCalibrationReferences({root,regions,signal}={}){
  signal?.throwIfAborted();
  if(typeof root!=='string'||!root||!Array.isArray(regions)||!regions.length)throw Error('Explicit Hydro reference root and regions required');
  const names=new Set(['rivers_base','lakes_base',...regions.flatMap(region=>[region?.riverLayer,region?.lakeLayer])]);
  if([...names].some(name=>typeof name!=='string'||!/^[A-Za-z0-9_-]+$/.test(name)))throw Error('Invalid Hydro reference layer');
  const base=await realpath(resolve(root)),layers={},sourceFiles={};
  for(const name of names){signal?.throwIfAborted();const path=await realpath(join(base,`${name}.geojson`)),within=relative(base,path);
    if(!within||within==='..'||within.startsWith('..'+sep)||isAbsolute(within))throw Error('Hydro reference layer leaves its source root');
    const before=await stat(path);if(!before.isFile()||before.size>128*1024*1024)throw Error('Bounded Hydro reference file required');
    const bytes=await readFile(path,{signal}),after=await stat(path);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino||before.dev!==after.dev||bytes.length!==before.size)
      throw Error('Hydro reference source changed while reading');
    const document=JSON.parse(bytes.toString('utf8'));if(document?.type!=='FeatureCollection'||!Array.isArray(document.features))
      throw Error('Invalid Hydro reference feature collection');
    layers[name]=document.features;sourceFiles[name]={file:within,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  signal?.throwIfAborted();return {...selectHydroCalibrationReferences({regions,layers}),sourceFiles};
}
