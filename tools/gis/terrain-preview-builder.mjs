// Build an in-memory terrain preview from the verified source inventory.
// Persisting or publishing generated output is a separate, explicit operation.
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {readNativeRawWebp} from '../map-image/native-resample.mjs';
import {withLibraryOutputs} from '../library-data.mjs';
import {contentFiles} from '../library-content.mjs';
import {rasterizeNativeTerrainLand} from './terrain-preview-native.mjs';
import {renderTerrainPreviewLevel,verifyTerrainPreviewTileEdges} from './terrain-preview-grid.mjs';
import {readPinnedTerrainAsset} from './terrain-preview-sources.mjs';

const version='0.13.3-p2',limit=32000000;
const hash=data=>createHash('sha256').update(data).digest('hex');

export function readTerrainPreviewFiles(output){
  if(typeof output!=='string'||!output||!existsSync(output))throw Error('Preview output directory is required');
  const entries=contentFiles(output);
  if(entries.reduce((sum,entry)=>sum+entry.bytes,0)>limit)throw Error('Terrain preview exceeds byte budget');
  return new Map(entries.map(entry=>[entry.logical,readFileSync(entry.path)]));
}

export async function buildTerrainPreview({source,cache,fetcher,signal,terrainOptions={},imageOptions={}}){
  signal?.throwIfAborted();
  const {dem,assets,countries,landMaskSha256}=source||{};
  if(!dem||!(assets instanceof Map)||!countries||!/^[a-f0-9]{64}$/.test(landMaskSha256||'')||
    !Array.isArray(dem.levels)||dem.levels.length<2||typeof cache!=='string'||!cache)
    throw Error('Validated terrain source and cache required');
  async function read(path,url){
    const spec=assets.get(path);if(!spec)throw Error('Missing pinned terrain source: '+path);
    const bytes=await readPinnedTerrainAsset({cache,path,url,spec,fetcher,signal});
    return readNativeRawWebp(bytes,{...imageOptions,signal,expectedSha256:spec.sha256});
  }
  const tintRgba=await read('terrain/v0.13.3/tint.webp',dem.tint.url);
  if(tintRgba.width!==dem.tint.width||tintRgba.height!==dem.tint.height)throw Error('DEM tint dimensions changed');
  const tint=Buffer.alloc(tintRgba.width*tintRgba.height*3);
  for(let i=0;i<tintRgba.width*tintRgba.height;i++){
    tint[i*3]=tintRgba.data[i*4];tint[i*3+1]=tintRgba.data[i*4+1];tint[i*3+2]=tintRgba.data[i*4+2];
  }
  const pending=[];let tileBytes=0;
  for(const level of dem.levels.slice(0,2)){
    signal?.throwIfAborted();
    const land=await rasterizeNativeTerrainLand({countries,x:0,y:0,width:level.width,height:level.height,
      levelWidth:level.width,levelHeight:level.height},{...terrainOptions,signal});
    const tiles=[];
    for(let row=0;row<level.rows;row++)for(let column=0;column<level.columns;column++){
      signal?.throwIfAborted();const path=`terrain/v0.13.0/${level.id}/${column}-${row}.webp`;
      const url=dem.urlTemplate.replaceAll('{level}',String(level.id)).replaceAll('{column}',String(column)).replaceAll('{row}',String(row));
      tiles.push({column,row,...await read(path,url)});
    }
    const rendered=await renderTerrainPreviewLevel({level,tiles,tint:{width:tintRgba.width,height:tintRgba.height,data:tint},land},
      {signal,terrainOptions,imageOptions});
    tileBytes+=rendered.tileBytes;if(tileBytes>limit)throw Error('Terrain preview exceeds byte budget');pending.push(...rendered.tiles);
  }
  const digest=createHash('sha256'),checksums={};
  for(const tile of pending){digest.update(tile.path+'\0').update(Buffer.from(tile.sha256,'hex'));
    checksums[tile.path]={bytes:tile.data.length,sha256:tile.sha256};}
  const manifest={version,representation:'raster-rgba-v1',dataset:'ETOPO 2022 DEM derived preview',crs:'EPSG:4326',
    extent:[-180,-90,180,90],tileFormat:'lossless WebP RGBA',gutter:1,
    channels:{rgb:'elevation-tinted land or bathymetry with multidirectional relief',alpha:'elevation grayscale with multidirectional relief, not opacity'},
    displayColors:{oceanRepresentative:'#6aa8d2'},levels:dem.levels.slice(0,2),
    urlTemplate:`terrain-preview/v${version}/{level}/{column}-{row}.webp`,
    sourceDem:{version:dem.version,assetsSha256:dem.assetsSha256,tintSha256:dem.tint.sha256,landMaskSha256},
    assetsSha256:digest.digest('hex'),tiles:checksums};
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  if(tileBytes+manifestBytes.length>limit)throw Error('Terrain preview exceeds byte budget');
  return {manifest,manifestBytes,manifestSha256:hash(manifestBytes),tiles:pending,tileBytes,totalBytes:tileBytes+manifestBytes.length};
}

// Validate the complete generated inventory and decoded seams, independently of its producer.
export async function verifyTerrainPreviewFiles({source,files,signal,imageOptions={}}){
  signal?.throwIfAborted();
  const {dem,landMaskSha256}=source||{};
  if(!dem||!Array.isArray(dem.levels)||dem.levels.length<2||!(files instanceof Map))throw Error('Pinned preview source and files required');
  const bytes=files.get('manifest.json');if(!(bytes instanceof Uint8Array))throw Error('Preview manifest missing');
  let manifest;try{manifest=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw Error('Invalid preview manifest');}
  if(!Buffer.from(bytes).equals(Buffer.from(JSON.stringify(manifest,null,2)+'\n'))||manifest.version!==version||
    manifest.representation!=='raster-rgba-v1'||manifest.gutter!==1||
    JSON.stringify(manifest.levels)!==JSON.stringify(dem.levels.slice(0,2))||
    manifest.sourceDem?.version!==dem.version||manifest.sourceDem?.assetsSha256!==dem.assetsSha256||
    manifest.sourceDem?.tintSha256!==dem.tint?.sha256||manifest.sourceDem?.landMaskSha256!==landMaskSha256)
    throw Error('Preview manifest identity differs from pinned source');
  const expected=[];for(const level of dem.levels.slice(0,2))for(let row=0;row<level.rows;row++)
    for(let column=0;column<level.columns;column++)expected.push(`${level.id}/${column}-${row}.webp`);
  const inventory=['manifest.json',...expected].sort();
  if(JSON.stringify([...files.keys()].sort())!==JSON.stringify(inventory)||
    JSON.stringify(Object.keys(manifest.tiles||{}).sort())!==JSON.stringify([...expected].sort()))
    throw Error('Preview tile inventory differs');
  const digest=createHash('sha256');let tileBytes=0;
  for(const level of dem.levels.slice(0,2)){
    const decoded=[];
    for(let row=0;row<level.rows;row++)for(let column=0;column<level.columns;column++){
      signal?.throwIfAborted();const path=`${level.id}/${column}-${row}.webp`,data=files.get(path),pin=manifest.tiles[path];
      if(!(data instanceof Uint8Array)||!pin||data.length!==pin.bytes||hash(data)!==pin.sha256)throw Error('Preview tile hash differs: '+path);
      tileBytes+=data.length;if(tileBytes+bytes.length>limit)throw Error('Terrain preview exceeds byte budget');
      digest.update(path+'\0').update(Buffer.from(pin.sha256,'hex'));
      decoded.push({column,row,...await readNativeRawWebp(data,{...imageOptions,signal,expectedSha256:pin.sha256})});
    }
    verifyTerrainPreviewTileEdges(level,decoded);
  }
  if(digest.digest('hex')!==manifest.assetsSha256)throw Error('Preview aggregate hash differs');
  return {tiles:expected.length,tileBytes,totalBytes:tileBytes+bytes.length,manifestSha256:hash(bytes)};
}

// Writes only a new output directory; existing output is always preserved.
export async function writeTerrainPreview({source,result,output,signal,imageOptions={}}){
  if(typeof output!=='string'||!output||!result||!Array.isArray(result.tiles))throw Error('Explicit preview output required');
  const files=new Map([['manifest.json',result.manifestBytes],...result.tiles.map(tile=>[tile.path,tile.data])]);
  const receipt=await verifyTerrainPreviewFiles({source,files,signal,imageOptions});
  const destination=resolve(output);
  return withLibraryOutputs({paths:[destination]},()=>{
    signal?.throwIfAborted();if(existsSync(destination))throw Error('Refusing to overwrite existing preview');
    mkdirSync(destination);
    for(const [path,data] of files){
      signal?.throwIfAborted();const target=resolve(destination,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,data,{flag:'wx'});
    }
    return receipt;
  });
}
