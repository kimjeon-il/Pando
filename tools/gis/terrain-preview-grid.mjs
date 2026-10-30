// Assemble DEM interiors and derive wrapped/clamped preview tiles without touching source tiles.
import {createHash} from 'node:crypto';
import {encodeNativeWebpLossless,readNativeRawWebp} from '../map-image/native-resample.mjs';
import {composeNativeTerrainPreview} from './terrain-preview-native.mjs';
function validateLevel(level){
  const {width,height,columns,rows,tileSize}=level||{};
  if(![width,height,columns,rows,tileSize].every(value=>Number.isSafeInteger(value)&&value>0)||
    width>16384||height>16384||width*height>16777216||tileSize>4096||
    columns!==Math.ceil(width/tileSize)||rows!==Math.ceil(height/tileSize))throw Error('Invalid terrain level grid');
  return {width,height,columns,rows,tileSize};
}
export function assembleTerrainDemLevel(level,tiles){
  const {width,height,columns,rows,tileSize}=validateLevel(level);
  if(!Array.isArray(tiles)||tiles.length!==columns*rows)throw Error('Missing or duplicate terrain source tile');
  const output=Buffer.alloc(width*height*4),seen=new Set();
  for(const tile of tiles){const {column,row}=tile||{};
    if(!Number.isSafeInteger(column)||column<0||column>=columns||!Number.isSafeInteger(row)||row<0||row>=rows)
      throw Error('Invalid terrain source tile location');
    const key=row*columns+column,innerWidth=Math.min(tileSize,width-column*tileSize),innerHeight=Math.min(tileSize,height-row*tileSize);
    if(seen.has(key)||tile.width!==innerWidth+2||tile.height!==innerHeight+2||!(tile.data instanceof Uint8Array)||tile.data.length!==tile.width*tile.height*4)
      throw Error('Invalid or duplicate terrain source tile');seen.add(key);
    for(let y=0;y<innerHeight;y++){
      const start=((y+1)*tile.width+1)*4,destination=((row*tileSize+y)*width+column*tileSize)*4;
      output.set(tile.data.subarray(start,start+innerWidth*4),destination);
    }
  }
  return {width,height,data:output};
}
export function extractTerrainPreviewTile(world,level,column,row){
  const {width,height,columns,rows,tileSize}=validateLevel(level);
  if(world?.width!==width||world.height!==height||!(world.data instanceof Uint8Array)||world.data.length!==width*height*4||
    !Number.isSafeInteger(column)||column<0||column>=columns||!Number.isSafeInteger(row)||row<0||row>=rows)
    throw Error('Invalid terrain preview tile request');
  const outWidth=Math.min(tileSize,width-column*tileSize)+2,outHeight=Math.min(tileSize,height-row*tileSize)+2;
  const output=Buffer.alloc(outWidth*outHeight*4);
  for(let y=0;y<outHeight;y++){const sourceY=Math.min(height-1,Math.max(0,row*tileSize+y-1));
    for(let x=0;x<outWidth;x++){const sourceX=(column*tileSize+x-1+width)%width,source=(sourceY*width+sourceX)*4;
      output.set(world.data.subarray(source,source+4),(y*outWidth+x)*4);}}
  return {width:outWidth,height:outHeight,data:output};
}
export async function renderTerrainPreviewLevel({level,tiles,tint,land},{signal,terrainOptions={},imageOptions={}}={}){
  signal?.throwIfAborted();const {width,height,columns,rows}=validateLevel(level);
  if(!Number.isSafeInteger(level.id)||level.id<0||!tint||!(tint.data instanceof Uint8Array)||
    !Number.isSafeInteger(tint.width)||tint.width<1||!Number.isSafeInteger(tint.height)||tint.height<1||tint.data.length!==tint.width*tint.height*3||
    !(land instanceof Uint8Array)||land.length!==width*height)throw Error('Explicit terrain tint and land pixels required');
  const dem=assembleTerrainDemLevel(level,tiles),pixels=await composeNativeTerrainPreview({dem:dem.data,tint:tint.data,land,
    width,height,tintWidth:tint.width,tintHeight:tint.height,x:0,y:0,levelWidth:width,levelHeight:height},{...terrainOptions,signal});
  const world={width,height,data:pixels},output=[];let tileBytes=0;
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    signal?.throwIfAborted();const tile=extractTerrainPreviewTile(world,level,column,row);
    const encoded=await encodeNativeWebpLossless(tile,{...imageOptions,signal}),decoded=await readNativeRawWebp(encoded.data,{...imageOptions,signal});
    if(decoded.width!==tile.width||decoded.height!==tile.height||!decoded.data.equals(tile.data))throw Error('Terrain preview WebP did not preserve RGBA pixels');
    tileBytes+=encoded.data.length;if(tileBytes>32000000)throw Error('Terrain preview exceeds byte budget');
    output.push({path:`${level.id}/${column}-${row}.webp`,width:tile.width,height:tile.height,data:encoded.data,
      sha256:createHash('sha256').update(encoded.data).digest('hex')});
  }
  return {tiles:output,tileBytes};
}
