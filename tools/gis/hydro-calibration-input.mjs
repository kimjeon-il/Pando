// Read only the Natural Earth layers explicitly used by the selected calibration regions.
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {basename,dirname,extname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {selectHydroCalibrationReferences} from './hydro-calibration-preparation.mjs';

async function findUniqueSources(roots,filenames,signal){
  const wanted=new Map(filenames.map(name=>[name.toLowerCase(),new Map()]));let visited=0;
  const add=async (path,name)=>{const actual=await realpath(path);wanted.get(name).set(process.platform==='win32'?actual.toLowerCase():actual,actual);};
  for(const root of roots){signal?.throwIfAborted();const actual=await realpath(resolve(root)),info=await stat(actual);
    if(info.isFile()){const name=basename(actual).toLowerCase();if(wanted.has(name))await add(actual,name);continue;}
    if(!info.isDirectory())throw Error('Hydro source root must be a file or directory');const pending=[actual];
    while(pending.length){const directory=pending.pop();for(const entry of await readdir(directory,{withFileTypes:true})){
      signal?.throwIfAborted();if(++visited>500000)throw Error('Hydro source discovery exceeds entry budget');
      const path=join(directory,entry.name);if(entry.isDirectory())pending.push(path);
      else if(entry.isFile()&&wanted.has(entry.name.toLowerCase()))await add(path,entry.name.toLowerCase());}}
  }
  return filenames.map(filename=>{const matches=wanted.get(filename.toLowerCase());
    if(matches.size!==1)throw Error(`Expected exactly one ${filename}, found ${matches.size}`);return [...matches.values()][0];});
}
async function findUniqueSource(roots,filename,signal){return (await findUniqueSources(roots,[filename],signal))[0];}
export async function fingerprintHydroCalibrationFile(path,signal){
  const before=await stat(path);if(!before.isFile())throw Error('Hydro source must be a file');const hash=createHash('sha256');let size=0;
  for await(const chunk of createReadStream(path,{signal})){signal?.throwIfAborted();size+=chunk.length;hash.update(chunk);}
  const after=await stat(path);if(size!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino||before.dev!==after.dev)
    throw Error('Hydro source changed while hashing');return {path,size,sha256:hash.digest('hex')};
}
async function shapefileMembers(shp,signal){
  const dir=dirname(shp),stem=basename(shp,extname(shp)).toLowerCase(),entries=await readdir(dir,{withFileTypes:true}),files={};
  for(const ext of ['shp','shx','dbf','prj','cpg']){const matches=entries.filter(entry=>entry.isFile()&&entry.name.toLowerCase()===`${stem}.${ext}`);
    if(matches.length>1||(!matches.length&&['shp','dbf'].includes(ext)))throw Error(`Expected one Hydro ${ext} source member`);
    if(matches.length)files[ext]=await fingerprintHydroCalibrationFile(await realpath(join(dir,matches[0].name)),signal);}
  return files;
}
export async function prepareHydroRiverSources({riverRoots,codes,signal}={}){
  signal?.throwIfAborted();const allowed=new Set(['af','ar','as','au','eu','gr','na','sa','si']);
  if(!Array.isArray(riverRoots)||!riverRoots.length||riverRoots.some(root=>typeof root!=='string'||!root)||
    !Array.isArray(codes)||!codes.length||new Set(codes).size!==codes.length||codes.some(code=>!allowed.has(code)))
    throw Error('Explicit unique Hydro river roots and regions required');
  const paths=await findUniqueSources(riverRoots,codes.map(code=>`HydroRIVERS_v10_${code}.shp`),signal),result=[];
  for(let index=0;index<paths.length;index++){const files=await shapefileMembers(paths[index],signal);
    if(!files.shx)throw Error('Hydro indexed generation requires a source SHX file');
    result.push({files,specification:{datasetCode:codes[index]},sourceFiles:Object.values(files).map(item=>({file:basename(item.path),sha256:item.sha256}))});}
  return result;
}
export async function prepareHydroCalibrationSourceFiles({riverRoots,hydrolakes,regions,signal}={}){
  signal?.throwIfAborted();
  if(!Array.isArray(riverRoots)||!riverRoots.length||riverRoots.some(root=>typeof root!=='string'||!root)||
    typeof hydrolakes!=='string'||!hydrolakes||!Array.isArray(regions)||!regions.length||
    regions.some(region=>typeof region?.riverCode!=='string'||!/^[a-z]{2}$/.test(region.riverCode)))
    throw Error('Explicit Hydro calibration source roots required');
  const lakePath=await findUniqueSource([hydrolakes],'HydroLAKES_polys_v10.shp',signal),lakeFiles=await shapefileMembers(lakePath,signal);
  const evidence=files=>Object.fromEntries(Object.entries(files).map(([ext,item])=>[ext,{size:item.size,sha256:item.sha256}]));
  const archives=[],sources={hydroLakes:{file:basename(lakePath),size:lakeFiles.shp.size,members:evidence(lakeFiles)},hydroRivers:{}};
  for(const code of new Set(regions.map(region=>region.riverCode))){const path=await findUniqueSource(riverRoots,`HydroRIVERS_v10_${code}.shp`,signal);
    const files=await shapefileMembers(path,signal);archives.push({files,specification:{datasetCode:code}});
    sources.hydroRivers[code]={file:basename(path),size:files.shp.size,members:evidence(files)};}
  signal?.throwIfAborted();return {archives,lakeFiles,sources};
}

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
