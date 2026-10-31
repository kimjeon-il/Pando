// Reconcile generated DEM gutters against their owning interior pixels.
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {lstat,open,readFile,realpath,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeNativeWebpLossless,readNativeRawWebp} from '../map-image/native-resample.mjs';
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
  const executable=process.platform==='win32'?'pando-terrain-dem-gutters.exe':'pando-terrain-dem-gutters';
  const {binary}=verifyNativeTool({root:workspace,directory,target:'terrain-dem-gutters',executable,sourceFiles:terrainDemGutterSources});
  const data=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'buffer',windowsHide:true,timeout:180000,maxBuffer:width*height*4+65536,signal},
      (error,stdout,stderr)=>error?reject(new Error('Native DEM gutter reconciliation failed: '+error.message+' '+String(stderr||''),{cause:error})):accept(stdout));
    child.stdin.on('error',()=>{});for(const part of parts)child.stdin.write(part);child.stdin.end();
  });
  if(data.length!==width*height*4)throw Error('Invalid native DEM gutter output');
  return {width,height,data,modified:!data.equals(Buffer.from(image.data.buffer,image.data.byteOffset,image.data.byteLength))};
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
    const encoded=await encodeNativeWebpLossless(result,options),decoded=await readNativeRawWebp(encoded.data,options);
    if(decoded.width!==result.width||decoded.height!==result.height||!decoded.data.equals(result.data))throw Error('DEM WebP round-trip changed pixels');
    const p=path(c,r),temporary=p+'.'+randomUUID()+'.tmp';let created=false;
    try{
      const handle=await open(temporary,'wx');created=true;
      try{await handle.writeFile(encoded.data,{signal});}finally{await handle.close();}
      const current=await readFile(p,{signal});
      if(createHash('sha256').update(current).digest('hex')!==item.sha)throw Error('DEM tile changed before replacement');
      await rename(temporary,p);created=false;modified++;
    }finally{if(created)await unlink(temporary);}
  }
  return modified;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==4)throw Error('Expected output directory and JSON level');
    console.log(JSON.stringify({modified:await reconcileDemGutterFiles(process.argv[2],JSON.parse(process.argv[3]))}));
  }catch(error){console.error('terrain-dem-gutters: '+error.message);process.exitCode=1;}
}
