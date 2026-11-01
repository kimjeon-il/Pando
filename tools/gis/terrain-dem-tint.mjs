// Native GDAL tint sampling; the caller owns and removes its temporary TIFF.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createWriteStream,existsSync} from 'node:fs';
import {mkdtemp,readFile,realpath,rmdir,stat,statfs,unlink} from 'node:fs/promises';
import {endianness} from 'node:os';
import {delimiter,isAbsolute,join,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';
import {fillGdalDemTint} from './terrain-dem-source.mjs';
import {encodeDemWebp} from './terrain-dem-webp.mjs';
import {hashTerrainFile} from './terrain-dem-assets.mjs';
import {zipMembers,zipMemberChunks} from '../lib/geonames-zip.mjs';
const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const terrainDemTintSources=Object.freeze(['tools/cpp/terrain-dem-tint/CMakeLists.txt','tools/cpp/terrain-dem-tint/tint.cpp']);

export async function sampleNativeDemTint({source,ice,land,temporary,width,height},
  {signal,root=defaultRoot,directory=process.env.PANDO_TERRAIN_DEM_TINT_DIRECTORY||resolve(root,'build-native/terrain-dem-tint/artifact'),fillDirectory}={}){
  signal?.throwIfAborted();
  if(endianness()!=='LE'||![source,ice,land,temporary].every(value=>typeof value==='string'&&value)||
    ![width,height].every(value=>Number.isSafeInteger(value)&&value>0)||width>30000||height>16384||width*height>12000000)
    throw Error('Explicit bounded tint sources and output dimensions are required');
  const originals=await Promise.all([source,ice,land].map(path=>realpath(path))),target=resolve(temporary);
  if(existsSync(target)||originals.includes(target))throw Error('Tint temporary TIFF exists or matches an original');
  const executable=process.platform==='win32'?'pando-terrain-dem-tint.exe':'pando-terrain-dem-tint';
  const {binary}=verifyNativeTool({root,directory,target:'terrain-dem-tint',executable,sourceFiles:terrainDemTintSources});
  const env={...process.env},bin=env.PANDO_TERRAIN_DEM_GDAL_BIN;
  if(bin){if(!isAbsolute(bin))throw Error('GDAL runtime directory must be absolute');env.PATH=bin+delimiter+(env.PATH||'');}
  const count=width*height;
  const output=await new Promise((accept,reject)=>execFile(binary,[...originals,target,String(width),String(height)],
    {encoding:'buffer',windowsHide:true,timeout:1800000,maxBuffer:16+count*13+65536,signal,env},
    (error,stdout,stderr)=>error?reject(new Error('Native DEM tint sampling failed: '+error.message+' '+String(stderr||''),{cause:error})):accept(stdout)));
  signal?.throwIfAborted();
  if(output.length!==16+count*13||output.toString('ascii',0,8)!=='PDTINT02'||output.readUInt32LE(8)!==width||output.readUInt32LE(12)!==height)
    throw Error('Invalid native DEM tint sampling receipt');
  const rgb=new Float32Array(count*3);Buffer.from(rgb.buffer).set(output.subarray(16,16+count*12));
  const valid=output.subarray(16+count*12),planar=await fillGdalDemTint({width,height,rgb,valid},
    {root,...(fillDirectory?{directory:fillDirectory}:{}),signal});
  const pixels=Buffer.alloc(count*3);for(let i=0;i<count;i++)for(let c=0;c<3;c++)pixels[i*3+c]=planar[c*count+i];
  const validCells=valid.reduce((total,value)=>total+Number(value!==0),0);
  return {width,height,rgb:pixels,validCells,regionalFillCells:count-validCells};
}

export async function renderNativeDemTint({source,ice,land,temporaryRoot,width,height},options={}){
  options.signal?.throwIfAborted();
  if(typeof temporaryRoot!=='string'||!temporaryRoot)throw Error('Explicit tint temporary directory is required');
  const shapeFiles=await Promise.all([ice,land].map(path=>readFile(path,{signal:options.signal})));
  const hashes=shapeFiles.map(bytes=>createHash('sha256').update(bytes).digest('hex'));
  const [iceData,landData]=shapeFiles.map(bytes=>JSON.parse(bytes.toString('utf8')));
  for(const data of [iceData,landData]){
    if(data?.type!=='FeatureCollection'||!Array.isArray(data.features)||!data.features.length||data.features.length>1000000||
      data.features.some(feature=>!feature?.geometry||!['Polygon','MultiPolygon'].includes(feature.geometry.type)))
      throw Error('Tint masks require nonempty polygon feature collections');
  }
  const ids=new Set();for(const feature of landData.features){
    if(!Object.hasOwn(feature,'id')||ids.has(feature.id))throw Error('Canonical country land mask has missing or duplicate IDs');ids.add(feature.id);
  }
  const before=await stat(source),folder=await mkdtemp(join(resolve(temporaryRoot),'.pando-dem-tint-')),temporary=join(folder,'masked.tif');
  try{
    const result=await sampleNativeDemTint({source,ice,land,temporary,width,height},options);
    const pixels=width*height,rgba=Buffer.alloc(pixels*4,255);
    for(let i=0;i<pixels;i++)result.rgb.copy(rgba,i*4,i*3,i*3+3);
    const webp=await encodeDemWebp({width,height,data:rgba},{signal:options.signal,workspace:options.root});
    const after=await stat(source),afterShapes=await Promise.all([ice,land].map(path=>readFile(path,{signal:options.signal})));
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||
      afterShapes.some((bytes,i)=>createHash('sha256').update(bytes).digest('hex')!==hashes[i]))
      throw Error('Tint inputs changed during processing');
    return {webp,validCells:result.validCells,regionalFillCells:result.regionalFillCells};
  }finally{
    try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
    await rmdir(folder);
  }
}

export async function buildNativeDemTintZip({archive,ice,land,temporaryRoot,width,height},options={}){
  const {signal}=options;signal?.throwIfAborted();
  if(![archive,ice,land,temporaryRoot].every(value=>typeof value==='string'&&value))throw Error('Explicit tint archive and inputs required');
  const archivePath=await realpath(archive),before=await stat(archivePath);
  if(!before.isFile()||before.size<22||before.size>64*1024**3)throw Error('Bounded tint ZIP archive required');
  const entries=(await zipMembers(archivePath,{maxCentral:8*1024*1024})).filter(item=>/\.tiff?$/i.test(item.name));
  if(entries.length!==1)throw Error('Tint ZIP must contain exactly one TIFF');
  const entry=entries[0];
  if(entry.name.includes(':')||entry.uncompressed<1||entry.uncompressed>64*1024**3)throw Error('Invalid tint ZIP entry path or size');
  const estimate=2*entry.uncompressed+128*1024**2;
  if(estimate>=1024**3){const disk=await statfs(resolve(temporaryRoot));
    if(disk.bavail*disk.bsize<estimate+5*1024**3)throw Error('Insufficient space for tint ZIP and 5 GiB headroom');}
  const [iceHash,landHash]=await Promise.all([hashTerrainFile(ice,{signal}),hashTerrainFile(land,{signal})]);
  const folder=await mkdtemp(join(resolve(temporaryRoot),'.pando-tint-')),source=join(folder,'source.tif');
  try{
    async function* verified(){for await(const chunk of zipMemberChunks(archivePath,entry)){signal?.throwIfAborted();yield chunk;}}
    await pipeline(Readable.from(verified()),createWriteStream(source,{flags:'wx'}),{signal});
    const result=await renderNativeDemTint({source,ice,land,temporaryRoot:folder,width,height},options);
    const after=await stat(archivePath),[iceAfter,landAfter]=await Promise.all([hashTerrainFile(ice,{signal}),hashTerrainFile(land,{signal})]);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||iceHash.sha256!==iceAfter.sha256||landHash.sha256!==landAfter.sha256)
      throw Error('Tint ZIP or masks changed during processing');
    return {...result,sourceEntry:entry.name,iceSourceSha256:iceHash.sha256,landMaskSourceSha256:landHash.sha256};
  }finally{
    try{await unlink(source);}catch(error){if(error.code!=='ENOENT')throw error;}
    await rmdir(folder);
  }
}
