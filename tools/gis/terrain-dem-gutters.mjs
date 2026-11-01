// Reconcile generated DEM gutters against their owning interior pixels.
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {lstat,open,readFile,realpath,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readNativeRawWebp} from '../map-image/native-resample.mjs';
import {encodeNativeDemElevation} from './terrain-dem-encode.mjs';
import {createNativeDemWindowReader,inspectNativeDemSource} from './terrain-dem-raster.mjs';
import {encodeDemWebp} from './terrain-dem-webp.mjs';
import {verifyNativeTool} from '../native-tool.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const terrainDemGutterSources=Object.freeze(['tools/cpp/terrain-dem-gutters/CMakeLists.txt','tools/cpp/terrain-dem-gutters/gutters.cpp']);
function validateImage(image){
  const {width,height,data}=image||{};
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||width>16384||height>16384||
     width*height>16777216||!(data instanceof Uint8Array)||data.length!==width*height*4)
    throw Error('A bounded RGBA DEM tile with gutters is required');
}
export function demTileEdges(image){
  validateImage(image);const {width,height,data}=image,bytes=Buffer.from(data.buffer,data.byteOffset,data.byteLength);
  const row=y=>Buffer.from(bytes.subarray(y*width*4,(y+1)*width*4));
  const column=x=>{const result=Buffer.alloc(height*4);for(let y=0;y<height;y++)bytes.copy(result,y*4,(y*width+x)*4,(y*width+x+1)*4);return result;};
  const topGutter=row(0),bottomGutter=row(height-1);
  return {width,height,left:column(1),right:column(width-2),top:row(1),bottom:row(height-2),topGutter,bottomGutter};
}
async function invokeGutterTool(image,parts,{signal,workspace=defaultRoot,directory=process.env.PANDO_TERRAIN_DEM_GUTTERS_DIRECTORY||resolve(workspace,'build-native/terrain-dem-gutters/artifact')}={}){
  const {width,height}=image,executable=process.platform==='win32'?'pando-terrain-dem-gutters.exe':'pando-terrain-dem-gutters';
  const {binary}=verifyNativeTool({root:workspace,directory,target:'terrain-dem-gutters',executable,sourceFiles:terrainDemGutterSources});
  const data=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'buffer',windowsHide:true,timeout:180000,maxBuffer:width*height*4+65536,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native DEM gutter operation failed: '+error.message+' '+String(stderr||''),{cause:error})):accept(stdout));
    child.stdin.on('error',()=>{});for(const part of parts)child.stdin.write(part);child.stdin.end();
  });
  if(data.length!==width*height*4)throw Error('Invalid native DEM gutter output');
  return {width,height,data,modified:!data.equals(Buffer.from(image.data.buffer,image.data.byteOffset,image.data.byteLength))};
}
export async function restoreDemPolarShadePixels(image,{north,south,top,bottom}={},options={}){
  options.signal?.throwIfAborted();validateImage(image);
  if(typeof north!=='boolean'||typeof south!=='boolean'||(!north&&!south)||
    (top!==undefined&&(!north||!(top instanceof Uint8Array)||top.length!==image.width))||
    (bottom!==undefined&&(!south||!(bottom instanceof Uint8Array)||bottom.length!==image.width)))
    throw Error('Valid polar shade rows and edges required');
  const header=Buffer.alloc(20);header.write('PDEMPOL1');header.writeUInt32LE(image.width,8);header.writeUInt32LE(image.height,12);
  header.writeUInt32LE(Number(north)+2*Number(south)+4*Number(top!==undefined)+8*Number(bottom!==undefined),16);
  return invokeGutterTool(image,[header,Buffer.from(image.data.buffer,image.data.byteOffset,image.data.byteLength),
    ...(top===undefined?[]:[top]),...(bottom===undefined?[]:[bottom])],options);
}
export async function reconcileDemGutterPixels(image,neighbors,{signal,workspace=defaultRoot,directory=process.env.PANDO_TERRAIN_DEM_GUTTERS_DIRECTORY||resolve(workspace,'build-native/terrain-dem-gutters/artifact')}={}){
  signal?.throwIfAborted();
  validateImage(image);const {width,height}=image,{west,east,north,south,northWest,northEast,southWest,southEast,hasNorth,hasSouth}=neighbors||{};
  for(const edge of [west,east,north,south,northWest,northEast,southWest,southEast]){
    if(!edge||![edge.width,edge.height].every(v=>Number.isInteger(v)&&v>=3)||
      !['left','right'].every(key=>Buffer.isBuffer(edge[key])&&edge[key].length===edge.height*4)||
      !['top','bottom','topGutter','bottomGutter'].every(key=>Buffer.isBuffer(edge[key])&&edge[key].length===edge.width*4))
      throw Error('Valid neighboring DEM tile edges are required');
  }
  if(typeof hasNorth!=='boolean'||typeof hasSouth!=='boolean'||west.height!==height||east.height!==height||
      north.width!==width||south.width!==width)throw Error('Neighboring DEM tile dimensions differ');
  const header=Buffer.alloc(20);header.write('PDEMGUT1');header.writeUInt32LE(width,8);header.writeUInt32LE(height,12);
  header.writeUInt32LE(Number(hasNorth)+2*Number(hasSouth),16);
  const parts=[header];for(const edge of [west,east,north,south,northWest,northEast,southWest,southEast]){
    const dimensions=Buffer.alloc(8);dimensions.writeUInt32LE(edge.width);dimensions.writeUInt32LE(edge.height,4);
    parts.push(dimensions,edge.left,edge.right,edge.top,edge.bottom,edge.topGutter,edge.bottomGutter);
  }
  parts.push(Buffer.from(image.data.buffer,image.data.byteOffset,image.data.byteLength));
  return invokeGutterTool(image,parts,{signal,workspace,directory});
}

export async function reconcileDemGutterFiles(output,level,{signal,workspace,directory}={}){
  signal?.throwIfAborted();
  if(typeof output!=='string'||!output||!Number.isSafeInteger(level?.id)||level.id<0||
    ![level.rows,level.columns].every(n=>Number.isSafeInteger(n)&&n>0&&n<=10000)||level.rows*level.columns>1000000)
    throw Error('Explicit bounded DEM level and output are required');
  const root=await realpath(output),folder=join(root,String(level.id)),folderInfo=await lstat(folder);
  if(!folderInfo.isDirectory()||folderInfo.isSymbolicLink())throw Error('DEM level must be a regular directory');
  const options={signal,...(workspace?{workspace}:{}),...(directory?{directory}:{})},edges=new Map(),hashes=new Map();
  const key=(c,r)=>`${c},${r}`,path=(c,r)=>join(folder,`${c}-${r}.webp`);
  const read=async(c,r)=>{
    signal?.throwIfAborted();const p=path(c,r),info=await lstat(p);
    if(!info.isFile()||info.isSymbolicLink())throw Error('DEM tile must be a regular file: '+p);
    const bytes=await readFile(p,{signal}),sha=createHash('sha256').update(bytes).digest('hex');
    return {sha,image:await readNativeRawWebp(bytes,options)};
  };
  for(let r=0;r<level.rows;r++)for(let c=0;c<level.columns;c++){
    const item=await read(c,r);edges.set(key(c,r),demTileEdges(item.image));hashes.set(key(c,r),item.sha);
  }
  const get=(c,r)=>edges.get(key((c+level.columns)%level.columns,Math.max(0,Math.min(level.rows-1,r))));
  let modified=0;
  for(let r=0;r<level.rows;r++)for(let c=0;c<level.columns;c++){
    const item=await read(c,r);if(item.sha!==hashes.get(key(c,r)))throw Error('DEM tile changed during gutter reconciliation');
    const result=await reconcileDemGutterPixels(item.image,{west:get(c-1,r),east:get(c+1,r),north:get(c,r-1),south:get(c,r+1),
      northWest:get(c-1,r-1),northEast:get(c+1,r-1),southWest:get(c-1,r+1),southEast:get(c+1,r+1),hasNorth:r>0,hasSouth:r<level.rows-1},
      {signal,...(workspace?{workspace}:{})});
    if(!result.modified)continue;
    const encoded=await encodeDemWebp(result,options);
    const p=path(c,r),temporary=p+'.'+randomUUID()+'.tmp';let created=false;
    try{
      const handle=await open(temporary,'wx');created=true;
      try{await handle.writeFile(encoded,{signal});}finally{await handle.close();}
      const current=await readFile(p,{signal});
      if(createHash('sha256').update(current).digest('hex')!==item.sha)throw Error('DEM tile changed before replacement');
      await rename(temporary,p);created=false;modified++;
    }finally{if(created)await unlink(temporary);}
  }
  return modified;
}

export async function restoreDemPolarGutterShade({output,source,levels,minLevel=0,maxLevel=5,strict=true},{signal}={}){
  signal?.throwIfAborted();
  if(typeof output!=='string'||!output||typeof source!=='string'||!source||!Array.isArray(levels)||!levels.length||
    !Number.isSafeInteger(minLevel)||!Number.isSafeInteger(maxLevel)||minLevel<0||maxLevel<minLevel||typeof strict!=='boolean')
    throw Error('Explicit DEM polar repair inputs are required');
  const root=await realpath(output);await inspectNativeDemSource({source,strict},{signal});let modified=0;
  for(const level of levels){
    const {id,width,height,tileSize,columns,rows}=level||{};
    if(![id,width,height,tileSize,columns,rows].every(Number.isSafeInteger)||id<0||width<1||width>50000||height<1||height>25000||
      tileSize<1||tileSize>4092||columns!==Math.ceil(width/tileSize)||rows!==Math.ceil(height/tileSize))throw Error('Invalid DEM polar level');
    if(id<minLevel||id>maxLevel)continue;
    const folder=join(root,String(id)),folderInfo=await lstat(folder);
    if(!folderInfo.isDirectory()||folderInfo.isSymbolicLink())throw Error('DEM level must be a regular directory');
    const reader=height>1350?await createNativeDemWindowReader({source,width,height,strict},{signal}):null;let failure;
    try{
      for(const row of [...new Set([0,rows-1])])for(let column=0;column<columns;column++){
        signal?.throwIfAborted();const path=join(folder,`${column}-${row}.webp`),info=await lstat(path);
        if(!info.isFile()||info.isSymbolicLink())throw Error('DEM tile must be a regular file');
        const original=await readFile(path,{signal}),hash=createHash('sha256').update(original).digest('hex');
        const image=await readNativeRawWebp(original,{signal}),x=column*tileSize,y=row*tileSize;
        const x1=Math.min(width,x+tileSize),y1=Math.min(height,y+tileSize);
        if(image.width!==x1-x+2||image.height!==y1-y+2)throw Error('DEM polar tile dimensions differ');
        const north=row===0,south=row===rows-1;let top,bottom;
        if(reader){
          const windowWidth=x1-x+4,windowHeight=y1-y+4,elevation=await reader.read([x-2,y-2,x1+2,y1+2]);
          const encoded=await encodeNativeDemElevation({width:windowWidth,height:windowHeight,levelWidth:width,levelHeight:height,north:y-2,elevation},
            {directory:process.env.PANDO_TERRAIN_DEM_ENCODE_DIRECTORY||resolve(defaultRoot,'build-native/terrain-dem-encode/artifact'),signal});
          if(north)top=encoded.shade.subarray(windowWidth+1,windowWidth+1+image.width);
          if(south)bottom=encoded.shade.subarray((windowHeight-2)*windowWidth+1,(windowHeight-2)*windowWidth+1+image.width);
        }
        const result=await restoreDemPolarShadePixels(image,{north,south,top,bottom},{signal});if(!result.modified)continue;
        const encoded=await encodeDemWebp(result,{signal}),temporary=path+'.'+randomUUID()+'.tmp';let created=false;
        try{
          const handle=await open(temporary,'wx');created=true;
          try{await handle.writeFile(encoded,{signal});}finally{await handle.close();}
          if(createHash('sha256').update(await readFile(path,{signal})).digest('hex')!==hash)throw Error('DEM tile changed before polar repair');
          await rename(temporary,path);created=false;modified++;
        }finally{if(created)await unlink(temporary);}
      }
    }catch(error){failure=error;throw error;}finally{if(reader)try{await reader.close();}catch(error){if(!failure)throw error;}}
  }
  return modified;
}
