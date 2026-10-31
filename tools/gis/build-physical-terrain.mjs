// Candidate-only Natural Earth physical terrain production.
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withLibraryOutputs} from '../library-data.mjs';
import {encodeNativeWebpLossless} from '../map-image/native-resample.mjs';
import {findSources,futureRealpath} from './build-physical-hydro.mjs';
import {readPhysicalRaster} from './physical-raster-native.mjs';
import {rasterizeNativeTerrainLand,resizeNativePhysicalRgb,resizeNativePhysicalMask,
  convertNativePhysicalLuminance,createNativePhysicalCompositor} from './terrain-preview-native.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
const version='0.12.6',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const names=['GRAY_HR_SR_OB.tif','HYP_HR_SR.tif','HYP_HR_SR_OB_DR.tif'];
export async function buildPhysicalTerrain({sourceRoot,outputRoot,countriesPath,root=rootDefault,
  sourceSize=[21600,10800],levelWidths=[1350,2700,5400,10800,21600],tileSize=1024,signal}={}){
  signal?.throwIfAborted();
  if(!sourceRoot||!outputRoot||!countriesPath||!Array.isArray(sourceSize)||sourceSize.length!==2||
    sourceSize.some(n=>!Number.isSafeInteger(n)||n<1)||sourceSize[0]!==2*sourceSize[1]||sourceSize[0]>30000||sourceSize[1]>16384||
    sourceSize[0]*sourceSize[1]>240000000||!Array.isArray(levelWidths)||!levelWidths.length||
    levelWidths.some(n=>!Number.isSafeInteger(n)||n<2||n%2||n>sourceSize[0])||
    !Number.isSafeInteger(tileSize)||tileSize<1||tileSize>4096||(tileSize+2)**2>16777216)
    throw Error('Invalid physical terrain inputs and bounded level configuration');
  sourceRoot=resolve(sourceRoot);outputRoot=resolve(outputRoot);countriesPath=resolve(countriesPath);
  const terrainDir=resolve(outputRoot,'terrain','v'+version),lakesPath=resolve(dirname(countriesPath),'hydro/lakes_base.geojson');
  if(existsSync(terrainDir))throw Error('Physical terrain output exists; preserve prior evidence');
  const rel=relative(realpathSync(sourceRoot),futureRealpath(outputRoot));
  if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))throw Error('Candidate output must be outside the source root');
  const paths=findSources(sourceRoot,names),countriesBytes=readFileSync(countriesPath),lakesBytes=readFileSync(lakesPath);
  const countries=JSON.parse(countriesBytes),lakes=JSON.parse(lakesBytes);
  if(countries?.type!=='FeatureCollection'||!Array.isArray(countries.features)||lakes?.type!=='FeatureCollection'||!Array.isArray(lakes.features))
    throw Error('Physical terrain requires country and lake feature collections');
  const rasters=[];for(const path of paths)rasters.push(await readPhysicalRaster(path,{signal}));
  const [gray,land,ocean]=rasters;
  if([gray,land,ocean].some(row=>row.width!==sourceSize[0]||row.height!==sourceSize[1])||land.mode!=='RGB'||ocean.mode!=='RGB')
    throw Error('Physical TIFF dimensions or color modes differ');
  const [sourceWidth,sourceHeight]=sourceSize;
  const sourceMask=await rasterizeNativeTerrainLand({countries:{type:'FeatureCollection',features:[...countries.features,...lakes.features]},
    x:0,y:0,width:sourceWidth,height:sourceHeight,levelWidth:sourceWidth,levelHeight:sourceHeight,fillHoles:true},{signal});
  return withLibraryOutputs({root,paths:[terrainDir]},async()=>{
    if(existsSync(terrainDir))throw Error('Physical terrain output exists; preserve prior evidence');
    mkdirSync(dirname(terrainDir),{recursive:true});mkdirSync(terrainDir);
    const levels=[];
    for(const [id,width] of levelWidths.entries()){
      signal?.throwIfAborted();const height=width/2,same=width===sourceWidth;
      const resize=pixels=>resizeNativePhysicalRgb({width:sourceWidth,height:sourceHeight,outputWidth:width,outputHeight:height,pixels},{signal});
      const levelLand=same?land.pixels:await resize(land.pixels),levelOcean=same?ocean.pixels:await resize(ocean.pixels);
      const grayPixels=same?gray.pixels:await resize(gray.pixels);
      const relief=await convertNativePhysicalLuminance({width,height,pixels:grayPixels},{signal});
      const mask=same?sourceMask:await resizeNativePhysicalMask({width:sourceWidth,height:sourceHeight,outputWidth:width,outputHeight:height,pixels:sourceMask},{signal});
      const columns=Math.ceil(width/tileSize),rows=Math.ceil(height/tileSize),levelDir=resolve(terrainDir,String(id));mkdirSync(levelDir);
      const compositor=createNativePhysicalCompositor({signal});let error;
      try{
        for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
          signal?.throwIfAborted();const box=[column*tileSize,row*tileSize,Math.min(width,(column+1)*tileSize),Math.min(height,(row+1)*tileSize)];
          const pixels=await compositor.combine({width,height,box,land:levelLand,ocean:levelOcean,mask,relief});
          const encoded=await encodeNativeWebpLossless({width:box[2]-box[0]+2,height:box[3]-box[1]+2,data:pixels},{signal});
          writeFileSync(resolve(levelDir,`${column}-${row}.webp`),encoded.data,{flag:'wx'});
        }
      }catch(cause){error=cause;throw cause;}finally{
        try{await compositor.close();}catch(cause){if(!error)throw cause;}
      }
      levels.push({id,width,height,columns,rows,tileSize});
    }
    if(sha(readFileSync(countriesPath))!==sha(countriesBytes)||sha(readFileSync(lakesPath))!==sha(lakesBytes))throw Error('Physical mask sources changed during build');
    const manifest={version,dataset:'Natural Earth raster 3.2.0 1:10m',crs:'EPSG:4326',extent:[-180,-90,180,90],tileFormat:'lossless WebP RGBA',
      channels:{rgb:'drainage-free cross-blended land combined with ocean-bottom colour',alpha:'Gray Earth relief, hypsography and ocean-bottom luminance'},
      displayColors:{oceanRepresentative:'#6aa8d2'},gutter:1,levels,urlTemplate:`terrain/v${version}/{level}/{column}-{row}.webp`,
      sources:[{file:basename(countriesPath),version:'Natural Earth 5.1.1',sha256:sha(countriesBytes)},
        {file:basename(lakesPath),version:'Natural Earth 5.0.0',sha256:sha(lakesBytes)},
        ...[gray,land,ocean].map((item,i)=>({file:names[i],version:'3.2.0',sha256:item.sha256}))]};
    writeFileSync(resolve(terrainDir,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});return manifest;
  });
}
