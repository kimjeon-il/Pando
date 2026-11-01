// Generate one immutable DEM level using the existing native raster and image owners.
import {randomUUID} from 'node:crypto';
import {constants,realpathSync} from 'node:fs';
import {copyFile,lstat,mkdir,open,readFile,realpath,rename,stat,statfs,unlink} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {withLibraryOutputs} from '../library-data.mjs';
import {futureRealpath} from './build-physical-hydro.mjs';
import {hashTerrainFile,summarizeTerrainAssets} from './terrain-dem-assets.mjs';
import {encodeNativeDemElevation} from './terrain-dem-encode.mjs';
import {reconcileDemGutterFiles,restoreDemPolarGutterShade} from './terrain-dem-gutters.mjs';
import {createNativeDemWindowReader,inspectNativeDemSource} from './terrain-dem-raster.mjs';
import {buildNativeDemTintZip} from './terrain-dem-tint.mjs';
import {encodeDemWebp} from './terrain-dem-webp.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const version='0.13.3',tileSize=1024;
const iceUrl='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/693f11422f4e08d2da4566b854dda53eb7c39fb3/geojson/ne_10m_glaciated_areas.geojson';
const defaultProfile=Object.freeze({strict:true,tintWidth:4096,tintHeight:2048,
  etopoSha256:'8630abc401cc6bdd30b507a68d3eb9eda5b65f5636f7199e4b1eefd476b5a9e2',
  tintSha256:'29ba984a14d96c3d745065b096eccf0a21207718d8549341c955c64b150e3e09',
  iceSha256:'04fd2303d5f0ece2cf482af19d06731d745db9690501d7b0a2a4b7fe23a7726f',
  levels:Array.from({length:6},(_,id)=>{const width=1350*2**id,height=675*2**id;
    return {id,width,height,columns:Math.ceil(width/tileSize),rows:Math.ceil(height/tileSize),tileSize};})});

async function writeExclusive(path,bytes,signal){const file=await open(path,'wx');
  try{await file.writeFile(bytes,{signal});}finally{await file.close();}}
async function replaceChecked(path,bytes,expected,signal){
  const temporary=path+'.'+randomUUID()+'.tmp';let created=false;
  try{
    await writeExclusive(temporary,bytes,signal);created=true;
    const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||!(await readFile(path,{signal})).equals(expected))
      throw Error('DEM metadata changed before replacement');
    await rename(temporary,path);created=false;
  }finally{if(created)await unlink(temporary);}
}

export async function buildTerrainDemCandidate({etopo,tintZip,ice,countries,output}={},
  {profile=defaultProfile,signal,workspace=root}={}){
  signal?.throwIfAborted();
  if(![etopo,tintZip,ice,countries,output].every(value=>typeof value==='string'&&value)||
    !profile||typeof profile.strict!=='boolean'||!Array.isArray(profile.levels)||!profile.levels.length||
    ![profile.tintWidth,profile.tintHeight].every(value=>Number.isSafeInteger(value)&&value>0)||
    ![profile.etopoSha256,profile.tintSha256,profile.iceSha256].every(value=>/^[a-f0-9]{64}$/.test(value)))
    throw Error('Explicit DEM candidate inputs, output and source policy are required');
  if(profile.levels.some((level,index)=>!level||level.id!==index||level.tileSize!==profile.levels[0].tileSize||
    ![level.width,level.height,level.tileSize,level.columns,level.rows].every(Number.isSafeInteger)||
    level.width<1||level.width>50000||level.height<1||level.height>25000||level.tileSize<1||level.tileSize>4092||
    level.columns!==Math.ceil(level.width/level.tileSize)||level.rows!==Math.ceil(level.height/level.tileSize)||level.rows*level.columns>1000000))
    throw Error('Invalid DEM candidate level configuration');
  output=resolve(output);const start=performance.now();
  const [source,tintSource,iceSource,landSource]=await Promise.all([etopo,tintZip,ice,countries].map(path=>hashTerrainFile(path,{signal})));
  if(source.sha256!==profile.etopoSha256||tintSource.sha256!==profile.tintSha256||iceSource.sha256!==profile.iceSha256)
    throw Error('DEM source checksum mismatch');
  const inputs=[etopo,tintZip,ice,countries],before=await Promise.all(inputs.map(path=>stat(path)));
  const metadata=await inspectNativeDemSource({source:etopo,strict:profile.strict},{signal});
  return withLibraryOutputs({root:workspace,paths:[output]},async()=>{
    signal?.throwIfAborted();await mkdir(dirname(output),{recursive:true});
    const estimated=profile.levels.reduce((sum,level)=>sum+level.width*level.height*4,0)+profile.tintWidth*profile.tintHeight*8;
    if(!Number.isSafeInteger(estimated)||estimated<1)throw Error('Invalid DEM candidate size');
    if(estimated>=1024**3){const disk=await statfs(dirname(output));
      if(disk.bavail*disk.bsize<estimated+5*1024**3)throw Error('Insufficient DEM space and 5 GiB headroom');}
    await mkdir(output); // Existing results are never modified by a new build.
    const reports=[];
    for(const level of profile.levels)reports.push(await generateTerrainDemLevel({source:etopo,output,level,strict:profile.strict},{signal}));
    const tint=await buildNativeDemTintZip({archive:tintZip,ice,land:countries,temporaryRoot:output,
      width:profile.tintWidth,height:profile.tintHeight},{signal});
    const tintPath=join(output,'tint.webp');await writeExclusive(tintPath,tint.webp,signal);
    const tintReport={algorithm:'canonical-land-average-nearest-fill-v2',validCells:tint.validCells,regionalFillCells:tint.regionalFillCells,
      sourceEntry:tint.sourceEntry,iceSourceSha256:tint.iceSourceSha256,landMaskSourceSha256:tint.landMaskSourceSha256};
    if(tint.iceSourceSha256!==iceSource.sha256||tint.landMaskSourceSha256!==landSource.sha256)throw Error('DEM mask source changed during generation');
    for(let i=0;i<profile.levels.length;i++)reports[i].reconciledTiles=await reconcileDemGutterFiles(output,profile.levels[i],{signal});
    const summary=await summarizeTerrainAssets(output,profile.levels,{signal});
    for(let i=0;i<reports.length;i++){reports[i].bytes=summary.reports[i].bytes;reports[i].maxTileBytes=summary.reports[i].maxTileBytes;}
    const manifest={version,representation:'dem-relief-v1',dataset:'ETOPO 2022 30 arc-second Ice Surface',crs:'EPSG:4326',
      heightDatum:'EGM2008 (EPSG:3855)',sourceCrs:'EPSG:9518',extent:[-180,-90,180,90],registration:'cell-center',
      sourceGridOrigin:[-180,90],sourceResolutionDegrees:[360/metadata.width,180/metadata.height],tileFormat:'lossless WebP RGBA',
      channels:{r:'encoded elevation high byte',g:'encoded elevation low byte',b:'precomputed hillshade',a:'255'},
      elevation:{encode:'round(meters)+12000',decode:'R*256+G-12000',biasMeters:12000,spacingMeters:1,validEncodedRange:[0,65535]},
      shade:{azimuthDegrees:315,altitudeDegrees:45,ambient:0.42,diffuse:0.58,polarFallbackDegrees:89.5,quantizationStep:4},
      gutter:1,tileSize:profile.levels[0].tileSize,levels:profile.levels,urlTemplate:`terrain/v${version}/{level}/{column}-{row}.webp`,
      tint:{url:`terrain/v${version}/tint.webp`,width:profile.tintWidth,height:profile.tintHeight,
        sha256:(await hashTerrainFile(tintPath,{signal})).sha256,...tintReport},
      sources:[{url:'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/30s/30s_surface_elev_gtif/ETOPO_2022_v1_30s_N90W180_surface.tif',
        ...source,nodata:metadata.nodata,dtype:metadata.dtype,width:metadata.width,height:metadata.height},
        {url:'https://naturalearth.s3.amazonaws.com/10m_raster/HYP_HR.zip',...tintSource},
        {url:iceUrl,...iceSource},{role:'canonical-country-land-mask',path:basename(countries),...landSource}],assetsSha256:summary.assetsSha256,
      ...(profile===defaultProfile?{}:{validationOnly:true})};
    const after=await Promise.all(inputs.map(path=>stat(path)));
    if(after.some((value,i)=>value.size!==before[i].size||value.mtimeMs!==before[i].mtimeMs))throw Error('DEM source changed during generation');
    const manifestPath=join(output,'manifest.json'),temporary=join(output,'manifest.json.tmp');
    await writeExclusive(temporary,JSON.stringify(manifest,null,2)+'\n',signal);await rename(temporary,manifestPath);
    const report={completed:true,totalBytes:reports.reduce((sum,item)=>sum+item.bytes,0)+(await stat(tintPath)).size,
      seconds:Math.round(performance.now()-start)/1000,peakWorkingSetBytes:process.resourceUsage().maxRSS*1024,
      levelReports:reports,manifestSha256:(await hashTerrainFile(manifestPath,{signal})).sha256};
    await writeExclusive(join(output,'build-report.json'),JSON.stringify(report,null,2)+'\n',signal);
    return manifest;
  });
}

export async function rebuildTerrainDemTint({sourceOutput,tintZip,ice,countries,output}={},
  {profile=defaultProfile,signal,workspace=root}={}){
  signal?.throwIfAborted();
  if(![sourceOutput,tintZip,ice,countries,output].every(value=>typeof value==='string'&&value))throw Error('Explicit DEM reuse inputs and output required');
  const sourceRoot=realpathSync.native(sourceOutput);output=resolve(output);
  const rel=relative(sourceRoot,futureRealpath(output,{native:true}));
  if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))throw Error('DEM reuse output cannot be inside the source dataset');
  const [archiveHash,iceHash,landHash]=await Promise.all([tintZip,ice,countries].map(path=>hashTerrainFile(path,{signal})));
  if(archiveHash.sha256!==profile.tintSha256||iceHash.sha256!==profile.iceSha256)throw Error('Tint source checksum mismatch');
  const manifest=JSON.parse(await readFile(join(sourceRoot,'manifest.json'),{encoding:'utf8',signal}));
  if(manifest.representation!=='dem-relief-v1'||manifest.version===version||!Array.isArray(manifest.sources))throw Error('Earlier DEM dataset required');
  const originalVersion=manifest.version,sourceAssets=await summarizeTerrainAssets(sourceRoot,manifest.levels,{signal});
  if(sourceAssets.assetsSha256!==manifest.assetsSha256)throw Error('Source DEM dataset checksum mismatch');
  return withLibraryOutputs({root:workspace,paths:[output]},async()=>{
    const start=performance.now();await mkdir(dirname(output),{recursive:true});
    const estimate=sourceAssets.reports.reduce((sum,item)=>sum+item.bytes,0)+profile.tintWidth*profile.tintHeight*8;
    if(estimate>=1024**3){const disk=await statfs(dirname(output));
      if(disk.bavail*disk.bsize<estimate+5*1024**3)throw Error('Insufficient DEM copy space and 5 GiB headroom');}
    await mkdir(output);
    const tint=await buildNativeDemTintZip({archive:tintZip,ice,land:countries,temporaryRoot:output,
      width:profile.tintWidth,height:profile.tintHeight},{signal});
    if(tint.iceSourceSha256!==iceHash.sha256||tint.landMaskSourceSha256!==landHash.sha256)throw Error('Tint mask source changed during processing');
    const tintPath=join(output,'tint.webp');await writeExclusive(tintPath,tint.webp,signal);
    const tintReport={algorithm:'canonical-land-average-nearest-fill-v2',validCells:tint.validCells,regionalFillCells:tint.regionalFillCells,
      sourceEntry:tint.sourceEntry,iceSourceSha256:tint.iceSourceSha256,landMaskSourceSha256:tint.landMaskSourceSha256};
    for(const level of manifest.levels){
      const sourceDir=join(sourceRoot,String(level.id)),info=await lstat(sourceDir);
      if(!info.isDirectory()||info.isSymbolicLink())throw Error('Source DEM level must be a regular directory');
      const targetDir=join(output,String(level.id));await mkdir(targetDir);
      for(let row=0;row<level.rows;row++)for(let column=0;column<level.columns;column++){
        signal?.throwIfAborted();const name=`${column}-${row}.webp`,from=join(sourceDir,name),to=join(targetDir,name),item=await lstat(from);
        if(!item.isFile()||item.isSymbolicLink())throw Error('Source DEM tile must be a regular file');
        const before=await hashTerrainFile(from,{signal});await copyFile(from,to,constants.COPYFILE_EXCL);
        const [after,copy]=await Promise.all([hashTerrainFile(from,{signal}),hashTerrainFile(to,{signal})]);
        if(before.sha256!==after.sha256||before.sha256!==copy.sha256)throw Error('DEM tile changed during copying');
      }
    }
    manifest.version=version;manifest.urlTemplate=`terrain/v${version}/{level}/{column}-{row}.webp`;
    manifest.tint={...tintReport,url:`terrain/v${version}/tint.webp`,width:profile.tintWidth,height:profile.tintHeight,
      sha256:(await hashTerrainFile(tintPath,{signal})).sha256};
    manifest.sources=manifest.sources.filter(source=>source.url!==iceUrl&&source.role!=='canonical-country-land-mask');
    manifest.sources.push({url:iceUrl,...iceHash},{role:'canonical-country-land-mask',path:basename(countries),...landHash});
    const summary=await summarizeTerrainAssets(output,manifest.levels,{signal});manifest.assetsSha256=summary.assetsSha256;
    const manifestPath=join(output,'manifest.json');await writeExclusive(manifestPath,JSON.stringify(manifest,null,2)+'\n',signal);
    const report={completed:true,copiedFromVersion:originalVersion,demTilesUnchanged:true,tint:tintReport,levelReports:summary.reports,
      totalBytes:summary.reports.reduce((sum,item)=>sum+item.bytes,0)+(await stat(tintPath)).size,
      manifestSha256:(await hashTerrainFile(manifestPath,{signal})).sha256,seconds:Math.round(performance.now()-start)/1000,
      peakWorkingSetBytes:process.resourceUsage().maxRSS*1024};
    await writeExclusive(join(output,'build-report.json'),JSON.stringify(report,null,2)+'\n',signal);return manifest;
  });
}

export async function repairTerrainDem({output,etopo,minLevel=0,maxLevel=5}={}, {signal,workspace=root}={}){
  signal?.throwIfAborted();if(typeof output!=='string'||!output)throw Error('Explicit DEM repair output required');
  const logicalOutput=resolve(output);
  return withLibraryOutputs({root:workspace,paths:[logicalOutput]},async()=>{
    output=await realpath(logicalOutput);
    const manifestPath=join(output,'manifest.json'),manifestInfo=await lstat(manifestPath);
    if(!manifestInfo.isFile()||manifestInfo.isSymbolicLink())throw Error('DEM manifest must be a regular file');
    const original=await readFile(manifestPath,{signal}),manifest=JSON.parse(original.toString('utf8'));
    const reportPath=join(output,'build-report.json');let reportBytes,previous={};
    try{const info=await lstat(reportPath);if(!info.isFile()||info.isSymbolicLink())throw Error('DEM report must be a regular file');
      reportBytes=await readFile(reportPath,{signal});previous=JSON.parse(reportBytes.toString('utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(etopo)await restoreDemPolarGutterShade({output,source:etopo,levels:manifest.levels,minLevel,maxLevel},{signal});
    for(const level of manifest.levels)await reconcileDemGutterFiles(output,level,{signal});
    const summary=await summarizeTerrainAssets(output,manifest.levels,{signal}),old=manifest.generation||{};
    delete manifest.generation;manifest.assetsSha256=summary.assetsSha256;
    await replaceChecked(manifestPath,Buffer.from(JSON.stringify(manifest,null,2)+'\n'),original,signal);
    const priorLevels=previous.levelReports||old.levelReports||[];
    const report={completed:true,totalBytes:summary.reports.reduce((sum,item)=>sum+item.bytes,0)+(await stat(join(output,'tint.webp'))).size,
      seconds:previous.seconds??old.seconds??null,peakWorkingSetBytes:previous.peakWorkingSetBytes??old.peakWorkingSetBytes??null,
      levelReports:summary.reports.map((item,index)=>({...item,seconds:priorLevels[index]?.seconds??null})),
      manifestSha256:(await hashTerrainFile(manifestPath,{signal})).sha256};
    const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');
    if(reportBytes)await replaceChecked(reportPath,bytes,reportBytes,signal);else await writeExclusive(reportPath,bytes,signal);
    return report;
  });
}

export async function generateTerrainDemLevel({source,output,level,strict=true},{signal}={}){
  signal?.throwIfAborted();
  const {id,width,height,tileSize,columns,rows}=level||{};
  if(typeof source!=='string'||!source||typeof output!=='string'||!output||typeof strict!=='boolean'||
    !Number.isSafeInteger(id)||id<0||![width,height,tileSize,columns,rows].every(Number.isSafeInteger)||
    width<1||width>50000||height<1||height>25000||tileSize<1||tileSize>4092||
    columns!==Math.ceil(width/tileSize)||rows!==Math.ceil(height/tileSize)||columns*rows>1000000)
    throw Error('Explicit bounded DEM level required');
  const outputRoot=await realpath(output);
  if(!(await stat(outputRoot)).isDirectory())throw Error('DEM output must be a directory');
  const folder=join(outputRoot,String(id));
  await mkdir(folder); // Refuse an existing or partially generated level.
  const start=performance.now();let count=0,bytes=0,maxTileBytes=0,reader,failure;
  try{
    reader=await createNativeDemWindowReader({source,width,height,strict},{signal});
    for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
      signal?.throwIfAborted();
      const x=column*tileSize,y=row*tileSize,x1=Math.min(width,x+tileSize),y1=Math.min(height,y+tileSize);
      const windowWidth=x1-x+4,windowHeight=y1-y+4,elevation=await reader.read([x-2,y-2,x1+2,y1+2]);
      const encoded=await encodeNativeDemElevation({width:windowWidth,height:windowHeight,levelWidth:width,levelHeight:height,north:y-2,elevation},
        {directory:process.env.PANDO_TERRAIN_DEM_ENCODE_DIRECTORY||resolve(root,'build-native/terrain-dem-encode/artifact'),signal});
      const tileWidth=windowWidth-2,tileHeight=windowHeight-2,pixels=Buffer.allocUnsafe(tileWidth*tileHeight*4);
      for(let r=0;r<tileHeight;r++)encoded.rgba.copy(pixels,r*tileWidth*4,((r+1)*windowWidth+1)*4,((r+1)*windowWidth+1+tileWidth)*4);
      const webp=await encodeDemWebp({width:tileWidth,height:tileHeight,data:pixels},{signal});
      const handle=await open(join(folder,`${column}-${row}.webp`),'wx');
      try{await handle.writeFile(webp,{signal});}finally{await handle.close();}
      count++;bytes+=webp.length;maxTileBytes=Math.max(maxTileBytes,webp.length);
    }
  }catch(error){failure=error;throw error;}
  finally{if(reader)try{await reader.close();}catch(error){if(!failure)throw error;}}
  return {level:id,tileCount:count,bytes,maxTileBytes,seconds:Math.round((performance.now()-start))/1000};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    const {values}=parseArgs({options:{etopo:{type:'string'},'tint-zip':{type:'string'},'glaciated-areas':{type:'string'},
      countries:{type:'string'},'reuse-dem':{type:'string'},output:{type:'string'},'repair-output':{type:'boolean'},
      'repair-polar-min-level':{type:'string'},'repair-polar-max-level':{type:'string'},help:{type:'boolean'}}});
    if(values.help)console.log('Usage: --output DIR [--etopo TIFF --tint-zip ZIP --glaciated-areas GEOJSON --countries GEOJSON | --reuse-dem DIR ... | --repair-output]');
    else{
      if(!values.output)throw Error('Explicit --output required');
      const input={etopo:values.etopo,tintZip:values['tint-zip'],ice:values['glaciated-areas'],countries:values.countries,output:values.output};
      const options={signal:controller.signal};let report;
      if(values['reuse-dem']){
        await rebuildTerrainDemTint({...input,sourceOutput:values['reuse-dem']},options);
        report=JSON.parse(await readFile(join(resolve(values.output),'build-report.json'),'utf8'));
      }else if(values['repair-output']){
        const number=(text,fallback)=>{if(text===undefined)return fallback;if(!/^\d+$/.test(text))throw Error('Invalid polar repair level');return Number(text);};
        report=await repairTerrainDem({output:values.output,etopo:values.etopo,
          minLevel:number(values['repair-polar-min-level'],0),maxLevel:number(values['repair-polar-max-level'],5)},options);
      }else{
        await buildTerrainDemCandidate(input,options);report=JSON.parse(await readFile(join(resolve(values.output),'build-report.json'),'utf8'));
      }
      console.log(JSON.stringify(report));
    }
  }catch(error){console.error('terrain-dem-build: '+error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
