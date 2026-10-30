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
  'tools/cpp/map-image/image-input.cpp','tools/cpp/map-image/image-input.h','tools/cpp/map-image/zlib-LICENSE','tools/cpp/map-image/libpng-LICENSE',
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
  const expected=size[0]*size[1]*4,encoded=action[0]==='encode-png',maximum=encoded?expected+size[1]+1048576:expected;
  const data=await runNative(nativeBinary(workspace,directory),[action[0],String(image.width),String(image.height),...action.slice(1).map(String)],image.data,maximum,signal);
  if((!encoded&&data.length!==expected)||(encoded&&data.length<8))throw Error('Native image output byte length mismatch');
  signal?.throwIfAborted();return {width:size[0],height:size[1],data};
}
export function resizeNativeRgba(image,size,options){
  return operateNativeRgba(image,size,['resize-rgba',...(Array.isArray(size)?size:[])],options);
}
export function rotateNativeRgba(image,degrees,options){
  if(![0,90,180,270].includes(degrees))return Promise.reject(Error('Invalid clockwise rotation'));
  const width=image?.width,height=image?.height,size=degrees===90||degrees===270?[height,width]:[width,height];
  return operateNativeRgba(image,size,['rotate-rgba',degrees],options);
}
export function encodeNativePng(image,options){
  return operateNativeRgba(image,[image?.width,image?.height],['encode-png'],options);
}
export async function readNativeImage({path,rect,format,maxPixels=4000000},{signal,workspace=root,directory=artifactDirectory(workspace)}={}){
  signal?.throwIfAborted();
  if(typeof path!=='string'||!path||!['png','jpeg','webp'].includes(format))throw Error('Image path and supported format are required');
  if(!Number.isInteger(maxPixels)||maxPixels<256||maxPixels>16777216)throw Error('Pixel budget must be 256..16777216');
  let coordinates=[0,0,0,0];
  if(rect!=null){
    coordinates=[rect.x,rect.y,rect.width,rect.height];
    if(coordinates.some(value=>!Number.isInteger(value)||value<0||value>16384)||rect.width<2||rect.height<2)
      throw Error('Source rectangle exceeds original pixel bounds');
  }
  const chunks=[];let bytes=0;
  for await(const chunk of createReadStream(path,{signal:signal||undefined})){
    bytes+=chunk.length;if(bytes>300*1024*1024)throw Error('Image input exceeds encoded byte budget');chunks.push(chunk);
  }
  signal?.throwIfAborted();
  const data=await runNative(nativeBinary(workspace,directory),['read-'+format,String(maxPixels),...coordinates.map(String)],Buffer.concat(chunks,bytes),44+16777216*4,signal);
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
