// Source-bound standalone C++ image primitive. No runtime compilation or fallback.
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,createReadStream,existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

export const mapImageSourceFiles=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/map-image/main.cpp',
  'tools/cpp/map-image/resample.cpp','tools/cpp/map-image/resample.h','tools/cpp/map-image/png.cpp',
  'tools/cpp/map-image/png.h','tools/cpp/map-image/png-read.c','tools/cpp/map-image/image-read.h','tools/cpp/map-image/jpeg-read.c','tools/cpp/map-image/webp-read.c',
  'tools/cpp/map-image/image-input.cpp','tools/cpp/map-image/image-input.h','tools/cpp/map-image/training-scan.h','tools/cpp/map-image/training-tile.h',
  'tools/cpp/reference-analysis/condition-sampling.h','tools/cpp/reference-analysis/training-photometry.h','tools/cpp/reference-analysis/CPYTHON-LICENSE','tools/cpp/map-preview/PILLOW-LICENSE',
  'tools/cpp/map-image/zlib-LICENSE','tools/cpp/map-image/libpng-LICENSE',
  'tools/cpp/map-image/libjpeg-turbo-LICENSE.md','tools/cpp/map-image/libjpeg-turbo-README.ijg','tools/cpp/map-image/libwebp-COPYING','tools/cpp/map-image/libwebp-PATENTS']);
const root=fileURLToPath(new URL('../../',import.meta.url));
export function collectMapImageArtifacts({workspace=root,revision,
  linuxDirectory=process.env.PANDO_MAP_IMAGE_LINUX_ARTIFACT||resolve(workspace,'build-native/map-image/linux-x64'),
  windowsDirectory=process.env.PANDO_MAP_IMAGE_WINDOWS_ARTIFACT||resolve(workspace,'build-native/map-image',process.platform==='win32'?'artifact':'win32-x64')}={}){
  if(revision!==undefined&&!/^[a-f0-9]{40}$/.test(revision))throw Error('A full pinned source revision is required');
  const entries=[];
  for(const [platform,directory,executable] of [['linux',linuxDirectory,'pando-map-image'],['win32',windowsDirectory,'pando-map-image.exe']]){
    const {binary,manifest}=verifyNativeTool({root:workspace,directory,target:'map-image',executable,sourceFiles:mapImageSourceFiles,platform,architecture:'x64'});
    if(revision)for(const file of manifest.sourceFiles){
      const source=execFileSync('git',['show',revision+':'+file.path],{cwd:workspace,encoding:'utf8',maxBuffer:16*1024*1024});
      if(createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex')!==file.sha256)
        throw Error('Native image artifact differs from pinned source: '+file.path);
    }
    const prefix=`build-native/map-image/${platform}-x64/`;
    entries.push({path:prefix+'native-tool.manifest.json',data:readFileSync(resolve(directory,'native-tool.manifest.json'))},
      {path:prefix+executable,data:readFileSync(binary)});
  }
  return entries;
}
function dimensions(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||width*height>16777216)
    throw Error('Image dimensions exceed the 16MP graph budget');
}
function nativeBinary(workspace,directory){
  const executable=process.platform==='win32'?'pando-map-image.exe':'pando-map-image';
  const {binary}=verifyNativeTool({root:workspace,directory,target:'map-image',executable,sourceFiles:mapImageSourceFiles});
  if(process.platform!=='win32'&&!process.env.PANDO_MAP_IMAGE_ARTIFACT&&existsSync(resolve(workspace,'.map-runtime.json')))
    chmodSync(binary,0o755);
  return binary;
}
async function runNative(binary,args,input,maximum,signal){
  return new Promise((accept,reject)=>{
    const child=spawn(binary,args,
      {stdio:['pipe','pipe','pipe'],windowsHide:true,signal:signal||undefined});
    const output=[],errors=[];let length=0,errorBytes=0,overflow=false,settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else accept(value);};
    const timer=setTimeout(()=>{child.kill();finish(Error('Native image operation timed out'));},120000);
    child.on('error',error=>finish(error));
    child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{length+=chunk.length;if(length>maximum){overflow=true;child.kill();}else output.push(chunk);});
    child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes<=65536)errors.push(chunk);});
    child.on('close',(code,reason)=>{
      if(code!==0||reason||overflow)return finish(Error('Native image operation failed: '+Buffer.concat(errors).toString('utf8')));
      finish(null,Buffer.concat(output,length));
    });
    child.stdin.end(input);
  });
}
function artifactDirectory(workspace){return process.env.PANDO_MAP_IMAGE_ARTIFACT||
  resolve(workspace,'build-native/map-image',existsSync(resolve(workspace,'.map-runtime.json'))?`${process.platform}-${process.arch}`:'artifact');}
async function operateNativeRgba(image,size,action,{signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();
  if(!image||!Array.isArray(size)||size.length!==2||!(image.data instanceof Uint8Array))throw Error('RGBA image and output size are required');
  dimensions(image.width,image.height);dimensions(size[0],size[1]);
  if(image.data.length!==image.width*image.height*4)throw Error('RGBA input byte length differs from dimensions');
  const expected=size[0]*size[1]*4,encoded=['encode-png','encode-webp-lossless'].includes(action[0]),maximum=encoded?expected+size[1]+1048576:expected;
  const data=await runNative(nativeBinary(workspace,directory),[action[0],String(image.width),String(image.height),...action.slice(1).map(String)],image.data,maximum,signal);
  if((!encoded&&data.length!==expected)||(encoded&&data.length<8))throw Error('Native image output byte length mismatch');
  signal?.throwIfAborted();return {width:size[0],height:size[1],data};
}
export function resizeNativeRgba(image,size,options){
  return operateNativeRgba(image,size,['resize-rgba',...(Array.isArray(size)?size:[])],options);
}
export function resizeNativeOpaqueBilinear(image,size,options){
  return operateNativeRgba(image,size,['resize-bilinear',...(Array.isArray(size)?size:[])],options);
}
export function applyNativeTrainingScan(image,{epoch,index,...options}={}){
  if(!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(index)||index<0)return Promise.reject(Error('Nonnegative training epoch and tile index required'));
  return operateNativeRgba(image,[image?.width,image?.height],['training-scan',epoch,index],options);
}
export async function prepareNativeTrainingTile({image,targetBits,knownBits,x,y,augment=false,epoch=0,index=0},
  {signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();dimensions(image?.width,image?.height);
  if(!(image.data instanceof Uint8Array)||image.data.length!==image.width*image.height*4||
    !(targetBits instanceof Uint8Array)||targetBits.length!==512*512||!(knownBits instanceof Uint8Array)||knownBits.length!==512*512||
    !Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=image.width||y>=image.height||typeof augment!=='boolean'||
    !Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(index)||index<0)throw Error('Invalid native training tile input');
  const sizes=[3*512*512*4,3*256*256*4,4*4,7*512*512*4,7*512*512*4],expected=sizes.reduce((a,b)=>a+b,0);
  const input=Buffer.concat([image.data,targetBits,knownBits]);
  const result=await runNative(nativeBinary(workspace,directory),['training-tile',String(image.width),String(image.height),String(x),String(y),augment?'1':'0',String(epoch),String(index)],input,expected,signal);
  if(result.length!==expected)throw Error('Native training tensor byte length mismatch');
  let offset=0;const fields={};for(const [i,name] of ['tile','overview','position','target','valid'].entries()){
    fields[name]=result.subarray(offset,offset+sizes[i]);offset+=sizes[i];}
  signal?.throwIfAborted();return fields;
}
export async function readNativeTrainingMask(bytes,sha256,{signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>300*1024*1024||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))
    throw Error('Bounded source-bound training mask required');
  if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error('Training mask hash changed');
  const data=await runNative(nativeBinary(workspace,directory),['training-mask'],bytes,8+16777216,signal);
  if(data.length<8)throw Error('Native training mask receipt is invalid');const width=data.readUInt32BE(0),height=data.readUInt32BE(4);
  dimensions(width,height);if(data.length!==8+width*height)throw Error('Native training mask byte length mismatch');
  signal?.throwIfAborted();return {width,height,data:data.subarray(8)};
}
export async function countNativeTrainingSupervision(target,known,{signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();dimensions(target?.width,target?.height);
  if(target.width!==known?.width||target.height!==known?.height||!(target.data instanceof Uint8Array)||!(known.data instanceof Uint8Array)||
    target.data.length!==target.width*target.height||known.data.length!==target.data.length)throw Error('Matching source-coordinate training masks required');
  const output=await runNative(nativeBinary(workspace,directory),['training-supervision',String(target.width),String(target.height)],
    Buffer.concat([target.data,known.data]),56,signal);
  if(output.length!==56)throw Error('Native training supervision receipt is invalid');
  const counts=Array.from({length:7},(_,i)=>[output.readUInt32BE(i*8),output.readUInt32BE(i*8+4)]);
  if(counts.some(([valid,positive])=>valid>target.data.length||positive>valid))throw Error('Native training supervision counts are invalid');
  return counts;
}
export async function convertNativeSemapLabels(labels,{signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();dimensions(labels?.width,labels?.height);
  const pixels=labels.width*labels.height;
  if(!(labels.data instanceof Uint8Array)||labels.data.length!==pixels)throw Error('Source-coordinate Semap label pixels required');
  const result=await runNative(nativeBinary(workspace,directory),['semap-labels',String(labels.width),String(labels.height)],labels.data,8+pixels*2,signal);
  if(result.length!==8+pixels*2)throw Error('Native Semap label output length differs');
  const knownCount=result.readUInt32BE(0),positiveCount=result.readUInt32BE(4);
  if(knownCount>pixels||positiveCount>knownCount)throw Error('Native Semap label counts are invalid');
  return {target:{width:labels.width,height:labels.height,data:result.subarray(8,8+pixels)},
    known:{width:labels.width,height:labels.height,data:result.subarray(8+pixels)},knownCount,positiveCount,
    informative:knownCount>=pixels*.03&&positiveCount>=pixels*.005};
}
export async function encodeNativeGrayPng(image,{signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();dimensions(image?.width,image?.height);
  if(!(image.data instanceof Uint8Array)||image.data.length!==image.width*image.height)throw Error('Grayscale image pixels required');
  const result=await runNative(nativeBinary(workspace,directory),['encode-gray',String(image.width),String(image.height)],image.data,
    image.data.length+image.height+1048576,signal);
  if(result.length<8)throw Error('Native grayscale PNG is truncated');return result;
}
export async function inspectNativeSemapImage(bytes,sha256,{signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();
  if(!(bytes instanceof Uint8Array)||bytes.length<2||bytes.length>8*1024*1024||bytes[0]!==255||bytes[1]!==216||
    typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||createHash('sha256').update(bytes).digest('hex')!==sha256)
    throw Error('Source-bound Semap JPEG required');
  const result=await runNative(nativeBinary(workspace,directory),['semap-image'],bytes,12,signal);
  if(result.length!==12)throw Error('Native Semap image receipt is invalid');
  const width=result.readUInt32BE(0),height=result.readUInt32BE(4),chromaSum=result.readUInt32BE(8);
  if(!width||!height||width>1200||height>1200||chromaSum>128*128*255)throw Error('Native Semap image metadata is invalid');
  const chroma=chromaSum/(128*128);return {width,height,chromaSum,chroma,mapKind:chroma<8?'monochrome':'color'};
}
export function resizeNativePdfThumbnail(image,size,options){
  return operateNativeRgba(image,size,['thumbnail-pdf',...(Array.isArray(size)?size:[])],options);
}
export function rotateNativeRgba(image,degrees,options){
  if(![0,90,180,270].includes(degrees))return Promise.reject(Error('Invalid clockwise rotation'));
  const width=image?.width,height=image?.height,size=degrees===90||degrees===270?[height,width]:[width,height];
  return operateNativeRgba(image,size,['rotate-rgba',degrees],options);
}
export function encodeNativePng(image,options){
  return operateNativeRgba(image,[image?.width,image?.height],['encode-png'],options);
}
export async function encodeNativeWebpLossless(image,options){
  const result=await operateNativeRgba(image,[image?.width,image?.height],['encode-webp-lossless'],options);
  if(result.data.length<12||result.data.toString('ascii',0,4)!=='RIFF'||result.data.toString('ascii',8,12)!=='WEBP')
    throw Error('Native lossless WebP output is invalid');
  return result;
}
export async function readNativeRawWebp(bytes,{expectedSha256,signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>300*1024*1024)throw Error('Bounded WebP source required');
  const input=Buffer.from(bytes);
  if(expectedSha256!==undefined&&(typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256)||createHash('sha256').update(input).digest('hex')!==expectedSha256))
    throw Error('Original WebP image hash changed');
  const result=await runNative(nativeBinary(workspace,directory),['read-webp-raw'],input,8+16777216*4,signal);
  if(result.length<8)throw Error('Native raw WebP receipt is truncated');
  const width=result.readUInt32BE(0),height=result.readUInt32BE(4);dimensions(width,height);
  if(result.length!==8+width*height*4)throw Error('Native raw WebP pixel length differs');
  signal?.throwIfAborted();return {width,height,data:result.subarray(8)};
}
export async function prepareNativeJpeg(bytes,maximumPixels=8000000,{signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();
  if(!(bytes instanceof Uint8Array)||bytes.length<2||bytes.length>300*1024*1024||bytes[0]!==255||bytes[1]!==216)throw Error('Expected bounded JPEG source');
  if(!Number.isInteger(maximumPixels)||maximumPixels<1||maximumPixels>16777216)throw Error('Pixel budget must be 1..16777216');
  const output=await runNative(nativeBinary(workspace,directory),['prepare-jpeg',String(maximumPixels)],bytes,20+maximumPixels*4+1048576,signal);
  if(output.length<20)throw Error('Native JPEG preparation receipt is truncated');
  const [originalWidth,originalHeight,width,height,changed]=Array.from({length:5},(_,i)=>output.readUInt32BE(i*4));
  if(!originalWidth||!originalHeight||originalWidth>65535||originalHeight>65535||!width||!height||
     width*height>maximumPixels||![0,1].includes(changed)||(changed===0&&output.length!==20)||
     (changed===1&&(output.length<22||output[20]!==255||output[21]!==216)))throw Error('Native JPEG preparation receipt is invalid');
  signal?.throwIfAborted();return {originalSize:[originalWidth,originalHeight],size:[width,height],changed:changed===1,data:output.subarray(20)};
}
export async function inspectNativeJpeg(bytes,{signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();
  if(!(bytes instanceof Uint8Array)||bytes.length<2||bytes.length>300*1024*1024||bytes[0]!==255||bytes[1]!==216)throw Error('Expected bounded JPEG source');
  const output=await runNative(nativeBinary(workspace,directory),['inspect-jpeg','16777216'],bytes,20,signal);
  if(output.length!==20)throw Error('Native JPEG inspection receipt is invalid');
  const [width,height,outWidth,outHeight,changed]=Array.from({length:5},(_,i)=>output.readUInt32BE(i*4));
  if(!width||!height||width>65535||height>65535||outWidth!==width||outHeight!==height||changed!==0)throw Error('Native JPEG inspection receipt is invalid');
  signal?.throwIfAborted();return [width,height];
}
export async function inspectNativeImageHeader(bytes,format,{signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();
  if(!['png','jpeg','webp'].includes(format))throw Error('Expected a supported image format');
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>300*1024*1024)throw Error('Expected a bounded image source');
  const output=await runNative(nativeBinary(workspace,directory),['header-'+format],bytes,12,signal);
  if(output.length!==12)throw Error('Native image header receipt is invalid');
  const width=output.readUInt32BE(0),height=output.readUInt32BE(4),orientation=output.readUInt32BE(8);
  if(!width||!height||width*height>600000000)throw Error('Native image header dimensions are invalid');
  const swap=orientation>=5&&orientation<=8;signal?.throwIfAborted();
  return {format,encodedSize:[width,height],orientation,size:swap?[height,width]:[width,height]};
}
function imageReadCoordinates(rect,format,maxPixels){
  if(!['png','jpeg','webp'].includes(format))throw Error('Supported image format required');
  if(!Number.isInteger(maxPixels)||maxPixels<256||maxPixels>16777216)throw Error('Pixel budget must be 256..16777216');
  let coordinates=[0,0,0,0];
  if(rect!=null){
    coordinates=[rect.x,rect.y,rect.width,rect.height];
    if(coordinates.some(value=>!Number.isInteger(value)||value<0||value>16384)||rect.width<2||rect.height<2)
      throw Error('Source rectangle exceeds original pixel bounds');
  }
  return coordinates;
}
export async function decodeNativeImageBytes({bytes,rect,format,maxPixels=4000000,expectedSha256},{signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>300*1024*1024)throw Error('Bounded image source required');
  const coordinates=imageReadCoordinates(rect,format,maxPixels);
  const encoded=Buffer.from(bytes);
  if(expectedSha256!==undefined&&(typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256)||createHash('sha256').update(encoded).digest('hex')!==expectedSha256))
    throw Error('Original image hash changed');
  const data=await runNative(nativeBinary(workspace,directory),['read-'+format,String(maxPixels),...coordinates.map(String)],encoded,44+16777216*4,signal);
  if(data.length<44)throw Error('Native image receipt is truncated');
  const fields=Array.from({length:11},(_,i)=>data.readUInt32BE(i*4));
  const [encodedWidth,encodedHeight,exifOrientation,originalWidth,originalHeight,x,y,width,height,outWidth,outHeight]=fields;
  dimensions(encodedWidth,encodedHeight);dimensions(originalWidth,originalHeight);dimensions(outWidth,outHeight);
  if(width<2||height<2||x+width>originalWidth||y+height>originalHeight||data.length!==44+outWidth*outHeight*4)
    throw Error('Native image receipt is invalid');
  signal?.throwIfAborted();
  return {width:outWidth,height:outHeight,originalWidth,originalHeight,mapping:{exifOrientation,encodedSize:[encodedWidth,encodedHeight],
    rect:{x,y,width,height},analysisSize:[outWidth,outHeight],coordinateSpace:'exif-oriented-original-pixels'},data:data.subarray(44)};
}
async function readEncodedImage(path,signal){
  const chunks=[];let length=0;
  for await(const chunk of createReadStream(path,{signal:signal||undefined})){
    length+=chunk.length;if(length>300*1024*1024)throw Error('Image input exceeds encoded byte budget');chunks.push(chunk);
  }
  signal?.throwIfAborted();return Buffer.concat(chunks,length);
}
export async function readNativeImage({path,rect,format,maxPixels=4000000,expectedSha256},options={}){
  options.signal?.throwIfAborted();
  if(typeof path!=='string'||!path||!['png','jpeg','webp'].includes(format))throw Error('Image path and supported format are required');
  imageReadCoordinates(rect,format,maxPixels);
  const bytes=await readEncodedImage(path,options.signal);
  return decodeNativeImageBytes({bytes,rect,format,maxPixels,expectedSha256},options);
}
export async function readNativeTrainingJpegOverview({path,expectedSha256},{workspace=root,directory=artifactDirectory(workspace),signal}={}){
  signal?.throwIfAborted();
  if(typeof path!=='string'||!path||typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256))
    throw Error('Source-bound JPEG path and SHA-256 required');
  const bytes=await readEncodedImage(path,signal);
  if(createHash('sha256').update(bytes).digest('hex')!==expectedSha256)throw Error('Original image hash changed');
  const output=await runNative(nativeBinary(workspace,directory),['training-jpeg-overview'],bytes,12+256*256*4,signal);
  if(output.length!==12+256*256*4)throw Error('Invalid JPEG training overview receipt');
  const width=output.readUInt32BE(0),height=output.readUInt32BE(4),orientation=output.readUInt32BE(8);
  if(!width||!height||width>65535||height>65535||width*height>600000000||orientation<1||orientation>4)
    throw Error('Invalid JPEG training overview dimensions or orientation');
  return {width,height,orientation,data:output.subarray(12)};
}
