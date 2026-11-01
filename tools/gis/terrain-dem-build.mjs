// Generate one immutable DEM level using the existing native raster and image owners.
import {mkdir,open,realpath,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeNativeDemElevation} from './terrain-dem-encode.mjs';
import {createNativeDemWindowReader} from './terrain-dem-raster.mjs';
import {encodeDemWebp} from './terrain-dem-webp.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));

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
  try{
    if(process.argv.length!==6||process.argv[2]!=='--level')throw Error('Expected --level SOURCE OUTPUT LEVEL_JSON');
    console.log(JSON.stringify(await generateTerrainDemLevel({source:process.argv[3],output:process.argv[4],level:JSON.parse(process.argv[5])})));
  }catch(error){console.error('terrain-dem-build: '+error.message);process.exitCode=1;}
}
